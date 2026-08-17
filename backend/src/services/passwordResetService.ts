import type { PrismaClient, User } from '@prisma/client';
import { env } from '../config/env.js';
import type { EmailProvider } from '../lib/email/emailProvider.js';
import { AppError } from '../lib/http/appError.js';
import { logger } from '../lib/logger.js';
import { hashPassword } from '../lib/password.js';
import { generateToken, hashToken } from '../lib/token.js';
import type { PasswordResetTokenRepository } from '../repositories/passwordResetTokenRepository.js';
import type { RefreshTokenRepository } from '../repositories/refreshTokenRepository.js';
import type { UserRepository } from '../repositories/userRepository.js';

const RESET_TOKEN_INVALID_MESSAGE = 'This reset link is invalid or has expired.';

function invalidResetToken(): AppError {
  return new AppError('AUTH_TOKEN_INVALID', RESET_TOKEN_INVALID_MESSAGE, 400);
}

export class PasswordResetService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly tokenRepository: PasswordResetTokenRepository,
    private readonly refreshTokenRepository: RefreshTokenRepository,
    private readonly emailProvider: EmailProvider,
    private readonly prisma: PrismaClient,
  ) {}

  async forgot(email: string): Promise<void> {
    const user = await this.userRepository.findByEmail(email.toLowerCase());
    if (!user || !user.isActive) {
      return;
    }

    await this.issueAndSend(user).catch((err) => {
      logger.warn({ err }, 'password reset email failed');
    });
  }

  async issueAndSend(user: User): Promise<void> {
    const rawToken = generateToken();

    await this.prisma.$transaction(async (tx) => {
      await this.tokenRepository.lockForUser(user.id, tx);
      const expiresAt = new Date(Date.now() + env.PASSWORD_RESET_TOKEN_TTL_MINUTES * 60_000);
      await this.tokenRepository.invalidateUnusedForUser(user.id, tx);
      await this.tokenRepository.create(
        {
          userId: user.id,
          tokenHash: hashToken(rawToken),
          expiresAt,
        },
        tx,
      );
    });

    const link = `${env.CORS_ORIGIN}/reset-password?token=${rawToken}`;
    await this.emailProvider.send({
      to: user.email,
      subject: 'Reset your password',
      body: `Use this token to reset your password: ${rawToken}\n${link}`,
      type: 'password-reset',
    });
  }

  async reset(rawToken: string, password: string): Promise<void> {
    const tokenHash = hashToken(rawToken);
    const passwordHash = await hashPassword(password);

    const outcome = await this.prisma.$transaction(async (tx) => {
      const record = await this.tokenRepository.findValidByHash(tokenHash, tx);
      if (!record) {
        throw invalidResetToken();
      }

      await this.tokenRepository.lockForUser(record.userId, tx);

      const user = await this.userRepository.findById(record.userId, tx);
      if (!user || !user.isActive) {
        await this.tokenRepository.markUsedIfActive(record.id, tx);
        return 'inactive' as const;
      }

      const usedCount = await this.tokenRepository.markUsedIfActive(record.id, tx);
      if (usedCount !== 1) {
        throw invalidResetToken();
      }

      await this.tokenRepository.invalidateUnusedForUser(user.id, tx);
      await this.userRepository.updatePasswordAndBumpEpoch(user.id, passwordHash, tx);
      await this.refreshTokenRepository.revokeAllLiveForUser(user.id, tx);
      return 'ok' as const;
    });

    if (outcome === 'inactive') {
      throw invalidResetToken();
    }
  }
}
