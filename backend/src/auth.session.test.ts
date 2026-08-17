import { beforeAll, describe, expect, it, jest } from '@jest/globals';
import type { PrismaClient, User } from '@prisma/client';
import { jwtVerify } from 'jose';
import type { RequestHandler } from 'express';
import request from 'supertest';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { AuthController } from './controllers/authController.js';
import { HealthController } from './controllers/healthController.js';
import { AppError } from './lib/http/appError.js';
import { hashPassword } from './lib/password.js';
import { hashToken } from './lib/token.js';
import {
  AUTH_RATE_LIMIT_MAX,
  createAuthRateLimit,
  type RedisRateLimitClient,
} from './middleware/authRateLimit.js';
import type { EmailVerificationTokenRepository } from './repositories/emailVerificationTokenRepository.js';
import type { RefreshTokenRepository } from './repositories/refreshTokenRepository.js';
import type { UserRepository } from './repositories/userRepository.js';
import { AuthService } from './services/authService.js';
import { EmailVerificationService } from './services/emailVerificationService.js';
import type { PasswordResetService } from './services/passwordResetService.js';
import type { HealthService } from './services/healthService.js';

const PASSWORD = 'password1';
const now = new Date('2026-08-14T00:00:00.000Z');

function fakePrisma(): PrismaClient {
  const fakeTx = {};
  return {
    $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn(fakeTx)),
  } as unknown as PrismaClient;
}

function mockHealth(): HealthController {
  return new HealthController({
    getReadiness: jest.fn(async () => ({
      status: 'ok',
      postgres: 'up',
      redis: 'up',
      uptime: 1,
    })),
  } as unknown as HealthService);
}

function storedUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user_1',
    email: 'ada@example.com',
    passwordHash: 'hashed',
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

function stubTokenRepo(): EmailVerificationTokenRepository {
  return {
    create: jest.fn(),
    findValidByHash: jest.fn(async () => null),
    markConsumedIfActive: jest.fn(async () => 0),
    invalidateActiveForUser: jest.fn(async () => undefined),
    lockForIssuance: jest.fn(async () => undefined),
  } as unknown as EmailVerificationTokenRepository;
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

type RefreshMocks = {
  create: jest.Mock<RefreshTokenRepository['create']>;
  revokeByHash: jest.Mock<RefreshTokenRepository['revokeByHash']>;
};

function sessionApp(
  userRepository: UserRepository,
  refreshMocks: RefreshMocks,
  authRateLimit?: RequestHandler,
) {
  const refreshTokenRepository = {
    create: refreshMocks.create,
    revokeByHash: refreshMocks.revokeByHash,
  } as unknown as RefreshTokenRepository;
  const emailVerificationService = new EmailVerificationService(
    userRepository,
    stubTokenRepo(),
    { send: jest.fn(async () => undefined) },
    fakePrisma(),
  );
  const authController = new AuthController(
    new AuthService(
      userRepository,
      async () => undefined,
      refreshTokenRepository,
      stubPasswordResetTokens() as never,
      fakePrisma(),
    ),
    emailVerificationService,
    { forgot: async () => undefined, reset: async () => undefined } as unknown as PasswordResetService,
  );
  return {
    app: createApp({
      healthController: mockHealth(),
      authController,
      authRateLimit,
    }),
    refreshMocks,
  };
}

function cookieHeader(res: request.Response, name: string): string | undefined {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list.find((line) => line.startsWith(`${name}=`));
}

function cookieValue(header: string): string {
  const pair = header.split(';')[0] ?? '';
  const eq = pair.indexOf('=');
  return eq >= 0 ? pair.slice(eq + 1) : '';
}

describe('POST /api/v1/auth/login and logout', () => {
  let passwordHash: string;

  beforeAll(async () => {
    passwordHash = await hashPassword(PASSWORD);
  });

  it('issues an HS256 access JWT and hashed refresh cookie for a verified active user', async () => {
    const user = storedUser({ passwordHash });
    const create = jest.fn<RefreshTokenRepository['create']>(async (input) => ({
      id: 'rt_1',
      userId: input.userId,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
      revokedAt: null,
      replacedByHash: null,
      userAgent: input.userAgent ?? null,
      createdAt: now,
    }));
    const revokeByHash = jest.fn<RefreshTokenRepository['revokeByHash']>(async () => 0);
    const { app } = sessionApp(
      { findByEmail: jest.fn(async () => user) } as unknown as UserRepository,
      { create, revokeByHash },
    );

    const before = Date.now();
    const res = await request(app)
      .post('/api/v1/auth/login')
      .set('User-Agent', 'Story23Browser/1.0')
      .send({ email: 'Ada@Example.com', password: PASSWORD })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.user).toEqual({
      id: 'user_1',
      email: 'ada@example.com',
      name: 'Ada Lovelace',
      isActive: true,
      emailVerifiedAt: '2026-08-14T00:00:00.000Z',
      systemRole: 'USER',
      createdAt: '2026-08-14T00:00:00.000Z',
      updatedAt: '2026-08-14T00:00:00.000Z',
    });
    expect(res.body.data.user).not.toHaveProperty('passwordHash');
    expect(res.body.data).not.toHaveProperty('refreshToken');
    expect(res.body.data).not.toHaveProperty('refresh_token');

    const accessToken = res.body.data.accessToken as string;
    const verified = await jwtVerify(
      accessToken,
      new TextEncoder().encode(env.JWT_ACCESS_SECRET),
    );
    expect(verified.protectedHeader.alg).toBe('HS256');
    expect(verified.payload.sub).toBe('user_1');
    expect(verified.payload.email).toBe('ada@example.com');
    expect(verified.payload.systemRole).toBe('USER');
    const ttl = (verified.payload.exp ?? 0) - (verified.payload.iat ?? 0);
    expect(ttl).toBe(env.ACCESS_TOKEN_TTL_SECONDS);

    const setCookie = cookieHeader(res, 'refresh_token');
    expect(setCookie).toBeDefined();
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).toMatch(/Path=\/api\/v1/i);
    expect(setCookie).toMatch(/Max-Age=604800/i);
    expect(setCookie).not.toMatch(/Secure/i);
    expect(setCookie).not.toMatch(/Domain=/i);

    const rawRefresh = cookieValue(setCookie!);
    expect(rawRefresh).toMatch(/^[a-f0-9]{64}$/);
    expect(create).toHaveBeenCalledTimes(1);
    const persisted = create.mock.calls[0]?.[0];
    expect(persisted?.tokenHash).toBe(hashToken(rawRefresh));
    expect(persisted?.tokenHash).not.toBe(rawRefresh);
    expect(persisted?.userId).toBe('user_1');
    expect(persisted?.userAgent).toBe('Story23Browser/1.0');
    const expectedExpiry = before + env.REFRESH_TOKEN_TTL_SECONDS * 1000;
    expect(persisted?.expiresAt.getTime()).toBeGreaterThan(expectedExpiry - 5_000);
    expect(persisted?.expiresAt.getTime()).toBeLessThan(expectedExpiry + 5_000);
    expect(JSON.stringify(res.body)).not.toContain(rawRefresh);
  });

  it('returns the same generic 401 for unknown, wrong password, and deactivated users', async () => {
    const verifiedUser = storedUser({ passwordHash });
    const deactivated = storedUser({ passwordHash, isActive: false });

    async function loginAs(findByEmail: User | null) {
      const create = jest.fn<RefreshTokenRepository['create']>(async () => {
        throw new Error('should not persist');
      });
      const { app } = sessionApp(
        { findByEmail: jest.fn(async () => findByEmail) } as unknown as UserRepository,
        { create, revokeByHash: jest.fn(async () => 0) },
      );
      return request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'ada@example.com', password: PASSWORD });
    }

    const unknown = await loginAs(null);
    const wrongPasswordApp = sessionApp(
      { findByEmail: jest.fn(async () => verifiedUser) } as unknown as UserRepository,
      {
        create: jest.fn(async () => {
          throw new Error('should not persist');
        }),
        revokeByHash: jest.fn(async () => 0),
      },
    );
    const wrongPassword = await request(wrongPasswordApp.app)
      .post('/api/v1/auth/login')
      .send({ email: 'ada@example.com', password: 'wrong-password' });
    const deactivatedRes = await loginAs(deactivated);

    for (const res of [unknown, wrongPassword, deactivatedRes]) {
      expect(res.status).toBe(401);
      expect(res.body).toEqual({
        success: false,
        error: {
          code: 'AUTH_UNAUTHORIZED',
          message: 'Invalid email or password.',
        },
      });
      expect(cookieHeader(res, 'refresh_token')).toBeUndefined();
    }
    expect(JSON.stringify(unknown.body)).toBe(JSON.stringify(wrongPassword.body));
    expect(JSON.stringify(wrongPassword.body)).toBe(JSON.stringify(deactivatedRes.body));
  });

  it('returns 403 EMAIL_NOT_VERIFIED for an unverified user with the correct password', async () => {
    const user = storedUser({ passwordHash, emailVerifiedAt: null });
    const create = jest.fn<RefreshTokenRepository['create']>(async () => {
      throw new Error('should not persist');
    });
    const { app } = sessionApp(
      { findByEmail: jest.fn(async () => user) } as unknown as UserRepository,
      { create, revokeByHash: jest.fn(async () => 0) },
    );

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'ada@example.com', password: PASSWORD })
      .expect(403);

    expect(res.body.error.code).toBe('EMAIL_NOT_VERIFIED');
    expect(res.body.error.message.toLowerCase()).toMatch(/verif/);
    expect(cookieHeader(res, 'refresh_token')).toBeUndefined();
    expect(create).not.toHaveBeenCalled();
  });

  it('does not 403 an unverified user when the password is wrong', async () => {
    const user = storedUser({ passwordHash, emailVerifiedAt: null });
    const { app } = sessionApp(
      { findByEmail: jest.fn(async () => user) } as unknown as UserRepository,
      { create: jest.fn(async () => {
        throw new Error('should not persist');
      }), revokeByHash: jest.fn(async () => 0) },
    );

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'ada@example.com', password: 'wrong-password' })
      .expect(401);

    expect(res.body.error.code).toBe('AUTH_UNAUTHORIZED');
  });

  it('returns 400 VALIDATION_ERROR with field details for an invalid body', async () => {
    const create = jest.fn<RefreshTokenRepository['create']>(async () => {
      throw new Error('should not persist');
    });
    const findByEmail = jest.fn();
    const { app } = sessionApp(
      { findByEmail } as unknown as UserRepository,
      { create, revokeByHash: jest.fn(async () => 0) },
    );

    const res = await request(app).post('/api/v1/auth/login').send({ email: 'bad', password: 'short' }).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toEqual(
      expect.objectContaining({
        email: expect.any(Array),
        password: expect.any(Array),
      }),
    );
    expect(findByEmail).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(cookieHeader(res, 'refresh_token')).toBeUndefined();
  });

  it('rejects a login password over 72 bytes', async () => {
    const create = jest.fn<RefreshTokenRepository['create']>(async () => {
      throw new Error('should not persist');
    });
    const findByEmail = jest.fn();
    const { app } = sessionApp(
      { findByEmail } as unknown as UserRepository,
      { create, revokeByHash: jest.fn(async () => 0) },
    );
    const password = 'a'.repeat(73);
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'ada@example.com', password })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(findByEmail).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('revokes the matching refresh row and clears the cookie on logout', async () => {
    const user = storedUser({ passwordHash });
    const create = jest.fn<RefreshTokenRepository['create']>(async (input) => ({
      id: 'rt_1',
      userId: input.userId,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
      revokedAt: null,
      replacedByHash: null,
      userAgent: input.userAgent ?? null,
      createdAt: now,
    }));
    const revokeByHash = jest.fn<RefreshTokenRepository['revokeByHash']>(async () => 1);
    const { app } = sessionApp(
      { findByEmail: jest.fn(async () => user) } as unknown as UserRepository,
      { create, revokeByHash },
    );

    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'ada@example.com', password: PASSWORD })
      .expect(200);
    const rawRefresh = cookieValue(cookieHeader(login, 'refresh_token')!);

    const logout = await request(app)
      .post('/api/v1/auth/logout')
      .set('Cookie', `refresh_token=${rawRefresh}`)
      .expect(200);

    expect(logout.body.success).toBe(true);
    expect(revokeByHash).toHaveBeenCalledWith(hashToken(rawRefresh));
    const cleared = cookieHeader(logout, 'refresh_token');
    expect(cleared).toBeDefined();
    expect(cleared).toMatch(/HttpOnly/i);
    expect(cleared).toMatch(/SameSite=Lax/i);
    expect(cleared).toMatch(/Path=\/api\/v1/i);
    expect(cleared).toMatch(/refresh_token=;/i);
    expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970/i);
  });

  it('returns 200 and still clears the cookie when logout has no matching row', async () => {
    const revokeByHash = jest.fn<RefreshTokenRepository['revokeByHash']>(async () => 0);
    const { app } = sessionApp({ findByEmail: jest.fn() } as unknown as UserRepository, {
      create: jest.fn(async () => {
        throw new Error('unused');
      }),
      revokeByHash,
    });

    const missing = await request(app).post('/api/v1/auth/logout').expect(200);
    expect(missing.body.success).toBe(true);
    expect(revokeByHash).not.toHaveBeenCalled();

    const unknown = await request(app)
      .post('/api/v1/auth/logout')
      .set('Cookie', 'refresh_token=deadbeef')
      .expect(200);
    expect(unknown.body.success).toBe(true);
    expect(revokeByHash).toHaveBeenCalledWith(hashToken('deadbeef'));
    expect(cookieHeader(unknown, 'refresh_token')).toMatch(/Path=\/api\/v1/i);
  });

  it('rejects excess login requests when a limiter is injected', async () => {
    const limiter: RequestHandler = (_req, _res, next) => {
      next(new AppError('RATE_LIMITED', 'Too many requests. Try again later.', 429));
    };
    const { app } = sessionApp({ findByEmail: jest.fn() } as unknown as UserRepository, {
      create: jest.fn(async () => {
        throw new Error('unused');
      }),
      revokeByHash: jest.fn(async () => 0),
    }, limiter);

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'ada@example.com', password: PASSWORD })
      .expect(429);

    expect(res.body.error.code).toBe('RATE_LIMITED');
  });

  it('rejects excess register requests when a limiter is injected', async () => {
    const limiter: RequestHandler = (_req, _res, next) => {
      next(new AppError('RATE_LIMITED', 'Too many requests. Try again later.', 429));
    };
    const { app } = sessionApp({ findByEmail: jest.fn() } as unknown as UserRepository, {
      create: jest.fn(async () => {
        throw new Error('unused');
      }),
      revokeByHash: jest.fn(async () => 0),
    }, limiter);

    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ name: 'Ada', email: 'ada@example.com', password: PASSWORD })
      .expect(429);

    expect(res.body.error.code).toBe('RATE_LIMITED');
  });

  it('applies createAuthRateLimit to login and register against a Redis stub', async () => {
    const incr = jest.fn<RedisRateLimitClient['incr']>(async () => AUTH_RATE_LIMIT_MAX + 1);
    const redis: RedisRateLimitClient = {
      isOpen: true,
      connect: jest.fn(async () => undefined),
      incr,
      ttl: jest.fn(async () => 50),
      expire: jest.fn(async () => 1),
    };
    const { app } = sessionApp({ findByEmail: jest.fn() } as unknown as UserRepository, {
      create: jest.fn(async () => {
        throw new Error('unused');
      }),
      revokeByHash: jest.fn(async () => 0),
    }, createAuthRateLimit(redis));

    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'ada@example.com', password: PASSWORD })
      .expect(429);
    const register = await request(app)
      .post('/api/v1/auth/register')
      .send({ name: 'Ada', email: 'ada@example.com', password: PASSWORD })
      .expect(429);

    expect(login.body.error.code).toBe('RATE_LIMITED');
    expect(register.body.error.code).toBe('RATE_LIMITED');
    expect(incr).toHaveBeenCalled();
  });
});
