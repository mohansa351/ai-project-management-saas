import type { PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';
import type { EmailProvider } from '../lib/email/emailProvider.js';
import { AppError } from '../lib/http/appError.js';
import { logger } from '../lib/logger.js';
import { generateToken, hashToken } from '../lib/token.js';
import type { EmailVerificationTokenRepository } from '../repositories/emailVerificationTokenRepository.js';
import type { UserRepository } from '../repositories/userRepository.js';
import { toPublicUser, type PublicUser } from './authService.js';

export class EmailVerificationService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly tokenRepository: EmailVerificationTokenRepository,
    private readonly emailProvider: EmailProvider,
    private readonly prisma: PrismaClient,
  ) {}

  /** Invalidates any prior unconsumed token, issues a fresh one, and mails it. One live token at a time. */
  async issueAndSend(user: PublicUser): Promise<void> {
    const rawToken = generateToken();
    const expiresAt = new Date(
      Date.now() + env.EMAIL_VERIFICATION_TOKEN_TTL_MINUTES * 60_000,
    );

    // Invalidating the prior token(s) and creating the new one must be atomic AND serialized
    // per-user, otherwise two concurrent issue calls could each see "no active token" (under
    // READ COMMITTED, a transaction alone doesn't prevent that) and both create a live one.
    await this.prisma.$transaction(async (tx) => {
      await this.tokenRepository.lockForIssuance(user.id, tx);
      await this.tokenRepository.invalidateActiveForUser(user.id, tx);
      await this.tokenRepository.create(
        {
          userId: user.id,
          tokenHash: hashToken(rawToken),
          expiresAt,
        },
        tx,
      );
    });

    const verifyUrl = `${env.CORS_ORIGIN}/verify-email?token=${encodeURIComponent(rawToken)}`;
    await this.emailProvider.send({
      to: user.email,
      subject: 'Verify your email',
      body: `Verify your email by opening this link:\n${verifyUrl}`,
      html: `<p>Verify your email by clicking <a href="${verifyUrl}">this verification link</a>.</p>`,
      type: 'verification',
    });
  }

  /** Consumes a valid token and marks the owning user's email verified. Invalid/expired/consumed → AUTH_TOKEN_INVALID. */
  async verify(rawToken: string): Promise<void> {
    const tokenHash = hashToken(rawToken);

    await this.prisma.$transaction(async (tx) => {
      const record = await this.tokenRepository.findValidByHash(tokenHash, tx);
      if (!record) {
        throw new AppError('AUTH_TOKEN_INVALID', 'This verification link is invalid or has expired.', 400);
      }

      // Atomically claim the token so two concurrent verify() calls on the same token
      // can't both pass the check above before either one consumes it.
      const consumedCount = await this.tokenRepository.markConsumedIfActive(record.id, tx);
      if (consumedCount !== 1) {
        throw new AppError('AUTH_TOKEN_INVALID', 'This verification link is invalid or has expired.', 400);
      }

      await this.userRepository.markEmailVerified(record.userId, tx);
    });
  }

  /** Anti-enumeration: only issues+sends when the account exists and is unverified; caller always reports generic success. */
  async resend(email: string): Promise<void> {
    const user = await this.userRepository.findByEmail(email);
    if (!user || user.emailVerifiedAt) {
      return;
    }

    // Isolate provider/DB failures so resend() always resolves and the controller always
    // returns the same generic 200, matching the unknown/verified-email path.
    await this.issueAndSend(toPublicUser(user)).catch((err) => {
      logger.warn({ err }, 'verification email failed');
    });
  }
}
