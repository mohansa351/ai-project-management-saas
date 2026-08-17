import type { PrismaClient, RefreshToken, User } from '@prisma/client';
import { AppError } from '../lib/http/appError.js';
import { AUTH_SESSION_UNAUTHORIZED_MESSAGE } from '../lib/http/authErrors.js';
import { signAccessToken } from '../lib/jwt.js';
import { hashPassword, verifyLoginPassword, verifyPassword } from '../lib/password.js';
import { generateToken, hashToken } from '../lib/token.js';
import type { PasswordResetTokenRepository } from '../repositories/passwordResetTokenRepository.js';
import type { RefreshTokenRepository } from '../repositories/refreshTokenRepository.js';
import { EMAIL_TAKEN_ERROR, type UserRepository } from '../repositories/userRepository.js';
import { env } from '../config/env.js';

export type PublicUser = {
  id: string;
  email: string;
  name: string;
  isActive: boolean;
  emailVerifiedAt: Date | null;
  systemRole: 'USER' | 'SUPER_ADMIN';
  createdAt: Date;
  updatedAt: Date;
};

export type OnUserRegistered = (user: PublicUser) => Promise<void>;

export type RegisterInput = {
  name: string;
  email: string;
  password: string;
};

export type LoginInput = {
  email: string;
  password: string;
  userAgent?: string;
};

export type LoginResult = {
  user: PublicUser;
  accessToken: string;
  refreshToken: string;
};

export type RefreshResult =
  | { outcome: 'rotated'; user: PublicUser; accessToken: string; refreshToken: string }
  | { outcome: 'overlap' }
  | { outcome: 'reject' }
  | { outcome: 'sign_failed' };

export type ChangePasswordInput = {
  userId: string;
  currentPassword: string;
  newPassword: string;
  userAgent?: string;
};

const AUTH_UNAUTHORIZED_MESSAGE = 'Invalid email or password.';

const SAME_PASSWORD_ERROR = {
  message: 'Validation failed',
  details: { newPassword: ['New password must be different from the current password'] },
} as const;

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    isActive: user.isActive,
    emailVerifiedAt: user.emailVerifiedAt,
    systemRole: user.systemRole,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

function unauthorized(): AppError {
  return new AppError('AUTH_UNAUTHORIZED', AUTH_UNAUTHORIZED_MESSAGE, 401);
}

function sessionUnauthorized(): AppError {
  return new AppError('AUTH_UNAUTHORIZED', AUTH_SESSION_UNAUTHORIZED_MESSAGE, 401);
}

function isLive(row: RefreshToken, now = new Date()): boolean {
  return row.revokedAt === null && row.expiresAt > now;
}

export class AuthService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly onUserRegistered: OnUserRegistered,
    private readonly refreshTokenRepository: RefreshTokenRepository,
    private readonly passwordResetTokenRepository: PasswordResetTokenRepository,
    private readonly prisma: PrismaClient,
  ) {}

  async register(input: RegisterInput): Promise<PublicUser> {
    const email = input.email.toLowerCase();
    const existing = await this.userRepository.findByEmail(email);
    if (existing) {
      throw new AppError(
        'VALIDATION_ERROR',
        EMAIL_TAKEN_ERROR.message,
        400,
        EMAIL_TAKEN_ERROR.details,
      );
    }

    const passwordHash = await hashPassword(input.password);
    const user = await this.userRepository.create({
      email,
      passwordHash,
      name: input.name,
      systemRole: 'USER',
    });
    const publicUser = toPublicUser(user);
    await this.onUserRegistered(publicUser);
    return publicUser;
  }

  async login(input: LoginInput): Promise<LoginResult> {
    const email = input.email.toLowerCase();
    const user = await this.userRepository.findByEmail(email);
    const passwordOk = await verifyLoginPassword(input.password, user);
    if (!user || !user.isActive || !passwordOk) {
      throw unauthorized();
    }

    if (!user.emailVerifiedAt) {
      throw new AppError(
        'EMAIL_NOT_VERIFIED',
        'Verify your email before signing in. Request a new link if the previous one expired.',
        403,
      );
    }

    const accessToken = await signAccessToken({
      sub: user.id,
      email: user.email,
      systemRole: user.systemRole,
    });

    const refreshToken = generateToken();
    const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_SECONDS * 1000);
    await this.refreshTokenRepository.create({
      userId: user.id,
      tokenHash: hashToken(refreshToken),
      expiresAt,
      userAgent: input.userAgent,
    });

    return { user: toPublicUser(user), accessToken, refreshToken };
  }

  async logout(rawRefreshToken: string | undefined): Promise<void> {
    if (!rawRefreshToken) {
      return;
    }
    await this.refreshTokenRepository.revokeByHash(hashToken(rawRefreshToken));
  }

  async refresh(rawRefreshToken: string, userAgent?: string): Promise<RefreshResult> {
    const presentedHash = hashToken(rawRefreshToken);

    const pending = await this.prisma.$transaction(async (tx) => {
      await this.refreshTokenRepository.lockForRotation(presentedHash, tx);
      const row = await this.refreshTokenRepository.findByHash(presentedHash, tx);
      if (!row || !isLive(row)) {
        return this.classifyNonLive(row, tx);
      }

      const user = await this.userRepository.findById(row.userId, tx);
      if (!user || !user.isActive || !user.emailVerifiedAt) {
        await this.refreshTokenRepository.revokeByHash(presentedHash, tx);
        return { outcome: 'reject' as const };
      }

      const successorRaw = generateToken();
      const successorHash = hashToken(successorRaw);
      const claimed = await this.refreshTokenRepository.claimRotation(presentedHash, successorHash, tx);
      if (claimed !== 1) {
        const again = await this.refreshTokenRepository.findByHash(presentedHash, tx);
        return this.classifyNonLive(again, tx);
      }

      const cas = await this.userRepository.casSessionEpoch(user.id, user.sessionEpoch, tx);
      if (cas !== 1) {
        return { outcome: 'reject' as const };
      }

      await this.refreshTokenRepository.create(
        {
          userId: user.id,
          tokenHash: successorHash,
          expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_SECONDS * 1000),
          userAgent,
        },
        tx,
      );

      return { outcome: 'rotated_pending' as const, user, refreshToken: successorRaw };
    });

    if (pending.outcome !== 'rotated_pending') {
      return pending;
    }

    try {
      const accessToken = await signAccessToken({
        sub: pending.user.id,
        email: pending.user.email,
        systemRole: pending.user.systemRole,
      });
      return {
        outcome: 'rotated',
        user: toPublicUser(pending.user),
        accessToken,
        refreshToken: pending.refreshToken,
      };
    } catch {
      return { outcome: 'sign_failed' };
    }
  }

  async changePassword(input: ChangePasswordInput): Promise<LoginResult> {
    const pending = await this.prisma.$transaction(async (tx) => {
      await this.passwordResetTokenRepository.lockForUser(input.userId, tx);

      const user = await this.userRepository.findById(input.userId, tx);
      if (!user || !user.isActive || !user.emailVerifiedAt) {
        throw sessionUnauthorized();
      }

      const currentOk = await verifyPassword(input.currentPassword, user.passwordHash);
      if (!currentOk) {
        throw sessionUnauthorized();
      }

      if (input.newPassword === input.currentPassword) {
        throw new AppError(
          'VALIDATION_ERROR',
          SAME_PASSWORD_ERROR.message,
          400,
          SAME_PASSWORD_ERROR.details,
        );
      }

      const passwordHash = await hashPassword(input.newPassword);
      const updated = await this.userRepository.updatePasswordAndBumpEpoch(user.id, passwordHash, tx);
      await this.refreshTokenRepository.revokeAllLiveForUser(user.id, tx);
      await this.passwordResetTokenRepository.invalidateUnusedForUser(user.id, tx);

      // Create AFTER revokeAll so the reissued row is not revoked in the same operation.
      const refreshToken = generateToken();
      await this.refreshTokenRepository.create(
        {
          userId: user.id,
          tokenHash: hashToken(refreshToken),
          expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_SECONDS * 1000),
          userAgent: input.userAgent,
        },
        tx,
      );

      return { user: updated, refreshToken };
    });

    try {
      const accessToken = await signAccessToken({
        sub: pending.user.id,
        email: pending.user.email,
        systemRole: pending.user.systemRole,
      });
      return {
        user: toPublicUser(pending.user),
        accessToken,
        refreshToken: pending.refreshToken,
      };
    } catch {
      throw new AppError('INTERNAL_ERROR', 'An unexpected error occurred.', 500);
    }
  }

  private async classifyNonLive(
    row: RefreshToken | null,
    tx: Parameters<RefreshTokenRepository['findByHash']>[1],
  ): Promise<{ outcome: 'overlap' } | { outcome: 'reject' }> {
    if (!row || row.expiresAt <= new Date()) {
      return { outcome: 'reject' };
    }
    if (row.revokedAt && row.replacedByHash === null) {
      return { outcome: 'reject' };
    }
    if (!row.replacedByHash) {
      return { outcome: 'reject' };
    }

    const successor = await this.refreshTokenRepository.findByHash(row.replacedByHash, tx);
    if (!successor) {
      return { outcome: 'reject' };
    }
    if (isLive(successor)) {
      return { outcome: 'overlap' };
    }
    if (successor.revokedAt && successor.replacedByHash === null) {
      return { outcome: 'reject' };
    }
    if (successor.replacedByHash) {
      await this.refreshTokenRepository.revokeLiveLeafOfChain(row, tx);
      return { outcome: 'reject' };
    }
    return { outcome: 'reject' };
  }
}
