import { describe, expect, it, jest } from '@jest/globals';
import type { PrismaClient, User } from '@prisma/client';
import { SignJWT } from 'jose';
import request from 'supertest';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { AuthController } from './controllers/authController.js';
import { HealthController } from './controllers/healthController.js';
import { AUTH_SESSION_UNAUTHORIZED_MESSAGE } from './lib/http/authErrors.js';
import { signAccessToken } from './lib/jwt.js';
import { createRequireAccessToken } from './middleware/requireAccessToken.js';
import type { EmailVerificationTokenRepository } from './repositories/emailVerificationTokenRepository.js';
import type { RefreshTokenRepository } from './repositories/refreshTokenRepository.js';
import type { UserRepository } from './repositories/userRepository.js';
import { AuthService } from './services/authService.js';
import { EmailVerificationService } from './services/emailVerificationService.js';
import type { PasswordResetService } from './services/passwordResetService.js';
import type { HealthService } from './services/healthService.js';

const now = new Date('2026-08-14T00:00:00.000Z');

function storedUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user_1',
    email: 'ada@example.com',
    passwordHash: 'secret-hash',
    name: 'Ada Lovelace',
    isActive: true,
    emailVerifiedAt: now,
    systemRole: 'USER',
    sessionEpoch: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function fakePrisma(): PrismaClient {
  return {
    $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn({})),
  } as unknown as PrismaClient;
}

function stubPasswordResetTokens() {
  return {
    create: jest.fn(),
    findValidByHash: jest.fn(async () => null),
    markUsedIfActive: jest.fn(async () => 0),
    invalidateUnusedForUser: jest.fn(async () => undefined),
    lockForUser: jest.fn(async () => undefined),
  };
}

function meApp(user: User | null) {
  const userRepository = {
    findByEmail: jest.fn(),
    findById: jest.fn(async () => user),
  } as unknown as UserRepository;
  const refreshTokenRepository = {
    create: jest.fn(),
    revokeByHash: jest.fn(async () => 0),
  } as unknown as RefreshTokenRepository;
  const authController = new AuthController(
    new AuthService(userRepository, async () => undefined, refreshTokenRepository, stubPasswordResetTokens() as never, fakePrisma()),
    new EmailVerificationService(
      userRepository,
      {
        create: jest.fn(),
        findValidByHash: jest.fn(async () => null),
        markConsumedIfActive: jest.fn(async () => 0),
        invalidateActiveForUser: jest.fn(async () => undefined),
        lockForIssuance: jest.fn(async () => undefined),
      } as unknown as EmailVerificationTokenRepository,
      { send: jest.fn(async () => undefined) },
      fakePrisma(),
    ),
    { forgot: async () => undefined, reset: async () => undefined } as unknown as PasswordResetService,
  );
  return createApp({
    healthController: new HealthController({
      getReadiness: jest.fn(async () => ({ status: 'ok', postgres: 'up', redis: 'up', uptime: 1 })),
    } as unknown as HealthService),
    authController,
    requireAccessToken: createRequireAccessToken(userRepository),
  });
}

function cookieHeader(res: request.Response, name: string): string | undefined {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list.find((line) => line.startsWith(`${name}=`));
}

describe('GET /api/v1/auth/me', () => {
  it('returns the public user for Bearer and bearer schemes', async () => {
    const token = await signAccessToken({
      sub: 'user_1',
      email: 'ada@example.com',
      systemRole: 'USER',
    });
    const app = meApp(storedUser());

    const upper = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`).expect(200);
    expect(upper.body).toEqual({
      success: true,
      data: {
        user: {
          id: 'user_1',
          email: 'ada@example.com',
          name: 'Ada Lovelace',
          isActive: true,
          emailVerifiedAt: '2026-08-14T00:00:00.000Z',
          systemRole: 'USER',
          createdAt: '2026-08-14T00:00:00.000Z',
          updatedAt: '2026-08-14T00:00:00.000Z',
        },
      },
    });
    expect(upper.body.data.user).not.toHaveProperty('passwordHash');
    expect(cookieHeader(upper, 'refresh_token')).toBeUndefined();

    const lower = await request(app).get('/api/v1/auth/me').set('Authorization', `bearer ${token}`).expect(200);
    expect(lower.body.data.user.email).toBe('ada@example.com');
    expect(cookieHeader(lower, 'refresh_token')).toBeUndefined();
  });

  it('returns 401 without touching the refresh cookie for bad Authorization', async () => {
    const app = meApp(storedUser());
    const cases = [
      request(app).get('/api/v1/auth/me'),
      request(app).get('/api/v1/auth/me').set('Authorization', 'Basic abc'),
      request(app).get('/api/v1/auth/me').set('Authorization', 'Bearer'),
      request(app).get('/api/v1/auth/me').set('Authorization', 'Bearer '),
    ];
    for (const pending of cases) {
      const res = await pending.expect(401);
      expect(res.body.error.code).toBe('AUTH_UNAUTHORIZED');
      expect(res.body.error.message).toBe(AUTH_SESSION_UNAUTHORIZED_MESSAGE);
      expect(cookieHeader(res, 'refresh_token')).toBeUndefined();
    }
  });

  it('rejects expired and wrong-signature JWTs', async () => {
    const app = meApp(storedUser());
    const expired = await new SignJWT({ email: 'ada@example.com', systemRole: 'USER' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('user_1')
      .setIssuedAt()
      .setExpirationTime(0)
      .sign(new TextEncoder().encode(env.JWT_ACCESS_SECRET));
    const wrong = await new SignJWT({ email: 'ada@example.com', systemRole: 'USER' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('user_1')
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(new TextEncoder().encode('not-the-access-secret-not-the-access'));

    await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${expired}`).expect(401);
    await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${wrong}`).expect(401);
  });

  it('rejects unknown, inactive, and unverified users', async () => {
    const token = await signAccessToken({
      sub: 'user_1',
      email: 'ada@example.com',
      systemRole: 'USER',
    });
    await request(meApp(null)).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`).expect(401);
    await request(meApp(storedUser({ isActive: false })))
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
    await request(meApp(storedUser({ emailVerifiedAt: null })))
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
  });
});
