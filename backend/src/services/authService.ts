import type { User } from '@prisma/client';
import { AppError } from '../lib/http/appError.js';
import { signAccessToken } from '../lib/jwt.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { generateToken, hashToken } from '../lib/token.js';
import { EMAIL_TAKEN_ERROR, type UserRepository } from '../repositories/userRepository.js';
import type { RefreshTokenRepository } from '../repositories/refreshTokenRepository.js';
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

const AUTH_UNAUTHORIZED_MESSAGE = 'Invalid email or password.';

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

export class AuthService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly onUserRegistered: OnUserRegistered,
    private readonly refreshTokenRepository: RefreshTokenRepository,
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
    if (!user || !user.isActive) {
      throw unauthorized();
    }

    let passwordOk = false;
    try {
      passwordOk = await verifyPassword(input.password, user.passwordHash);
    } catch {
      throw unauthorized();
    }
    if (!passwordOk) {
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
}
