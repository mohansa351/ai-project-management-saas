import { describe, expect, it, jest } from '@jest/globals';
import type { EmailVerificationToken, PrismaClient, User } from '@prisma/client';
import request from 'supertest';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { AuthController } from './controllers/authController.js';
import { HealthController } from './controllers/healthController.js';
import type { EmailProvider } from './lib/email/emailProvider.js';
import { hashToken } from './lib/token.js';
import type { EmailVerificationTokenRepository } from './repositories/emailVerificationTokenRepository.js';
import type { UserRepository } from './repositories/userRepository.js';
import { AuthService } from './services/authService.js';
import { EmailVerificationService } from './services/emailVerificationService.js';
import type { PasswordResetService } from './services/passwordResetService.js';
import type { HealthService, Readiness } from './services/healthService.js';
import type { RefreshTokenRepository } from './repositories/refreshTokenRepository.js';

/** Runs the callback immediately with a sentinel transaction client, mirroring how a mocked
 * repository ignores the tx argument it's passed. */
function fakePrisma(): PrismaClient {
  const fakeTx = {};
  return {
    $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn(fakeTx)),
  } as unknown as PrismaClient;
}

const okReadiness: Readiness = {
  status: 'ok',
  postgres: 'up',
  redis: 'up',
  uptime: 1,
};

function mockHealth(): HealthController {
  return new HealthController({
    getReadiness: jest.fn(async () => okReadiness),
  } as unknown as HealthService);
}

function storedUser(overrides: Partial<User> = {}): User {
  const now = new Date('2026-08-14T00:00:00.000Z');
  return {
    id: 'user_1',
    email: 'ada@example.com',
    passwordHash: 'hashed',
    name: 'Ada Lovelace',
    isActive: true,
    emailVerifiedAt: null,
    systemRole: 'USER',
    sessionEpoch: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function stubRefreshRepo(): RefreshTokenRepository {
  return {
    create: jest.fn(async () => ({
      id: 'rt_1',
      userId: 'user_1',
      tokenHash: 'hash',
      expiresAt: new Date(),
      revokedAt: null,
      userAgent: null,
      createdAt: new Date(),
    })),
    revokeByHash: jest.fn(async () => 0),
  } as unknown as RefreshTokenRepository;
}

function storedToken(overrides: Partial<EmailVerificationToken> = {}): EmailVerificationToken {
  const now = new Date('2026-08-14T00:00:00.000Z');
  return {
    id: 'token_1',
    userId: 'user_1',
    tokenHash: hashToken('raw-token'),
    expiresAt: new Date(now.getTime() + 60_000),
    consumedAt: null,
    createdAt: now,
    ...overrides,
  };
}

type MockUserRepo = {
  findByEmail: jest.Mock<UserRepository['findByEmail']>;
  markEmailVerified: jest.Mock<UserRepository['markEmailVerified']>;
  create?: jest.Mock;
};

type MockTokenRepo = {
  create: jest.Mock<EmailVerificationTokenRepository['create']>;
  findValidByHash: jest.Mock<EmailVerificationTokenRepository['findValidByHash']>;
  markConsumedIfActive: jest.Mock<EmailVerificationTokenRepository['markConsumedIfActive']>;
  invalidateActiveForUser: jest.Mock<EmailVerificationTokenRepository['invalidateActiveForUser']>;
  lockForIssuance: jest.Mock<EmailVerificationTokenRepository['lockForIssuance']>;
};

function buildApp(userRepo: MockUserRepo, tokenRepo: MockTokenRepo, emailProvider: EmailProvider) {
  const authController = new AuthController(
    new AuthService(
      userRepo as unknown as UserRepository,
      async () => undefined,
      stubRefreshRepo(),
      fakePrisma(),
    ),
    new EmailVerificationService(
      userRepo as unknown as UserRepository,
      tokenRepo as unknown as EmailVerificationTokenRepository,
      emailProvider,
      fakePrisma(),
    ),
    { forgot: async () => undefined, reset: async () => undefined } as unknown as PasswordResetService,
  );
  return createApp({ healthController: mockHealth(), authController });
}

describe('POST /api/v1/auth/verify-email', () => {
  it('marks emailVerifiedAt and consumes the token on a valid unexpired token', async () => {
    const user = storedUser();
    const token = storedToken();
    const userRepo: MockUserRepo = {
      findByEmail: jest.fn(async () => null),
      markEmailVerified: jest.fn(async () => ({ ...user, emailVerifiedAt: new Date() })),
    };
    const tokenRepo: MockTokenRepo = {
      create: jest.fn(async () => token),
      findValidByHash: jest.fn(async () => token),
      markConsumedIfActive: jest.fn(async () => 1),
      invalidateActiveForUser: jest.fn(async () => undefined),
      lockForIssuance: jest.fn(async () => undefined),
    };
    const send = jest.fn<EmailProvider['send']>(async () => undefined);
    const app = buildApp(userRepo, tokenRepo, { send });

    const res = await request(app)
      .post('/api/v1/auth/verify-email')
      .send({ token: 'raw-token' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(tokenRepo.findValidByHash).toHaveBeenCalledWith(hashToken('raw-token'), expect.anything());
    expect(tokenRepo.markConsumedIfActive).toHaveBeenCalledWith(token.id, expect.anything());
    expect(userRepo.markEmailVerified).toHaveBeenCalledWith(token.userId, expect.anything());
  });

  // These two states are both simulated by findValidByHash returning null (a consumed/expired
  // token never matches its where clause); this covers the controller/service behavior when the
  // repository reports "no valid token", not the repository's own query filtering. See
  // EmailVerificationTokenRepository's own test file for that.
  it.each([
    ['consumed', storedToken({ consumedAt: new Date() })],
    ['expired', storedToken({ expiresAt: new Date('2020-01-01T00:00:00.000Z') })],
  ])('returns 400 AUTH_TOKEN_INVALID and mutates nothing when findValidByHash reports no valid %s token', async () => {
    const userRepo: MockUserRepo = {
      findByEmail: jest.fn(async () => null),
      markEmailVerified: jest.fn(),
    };
    const tokenRepo: MockTokenRepo = {
      create: jest.fn(),
      // A consumed/expired token never matches findValidByHash's where clause.
      findValidByHash: jest.fn(async () => null),
      markConsumedIfActive: jest.fn(),
      invalidateActiveForUser: jest.fn(),
      lockForIssuance: jest.fn(),
    };
    const send = jest.fn<EmailProvider['send']>(async () => undefined);
    const app = buildApp(userRepo, tokenRepo, { send });

    const res = await request(app)
      .post('/api/v1/auth/verify-email')
      .send({ token: 'raw-token' })
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('AUTH_TOKEN_INVALID');
    expect(tokenRepo.markConsumedIfActive).not.toHaveBeenCalled();
    expect(userRepo.markEmailVerified).not.toHaveBeenCalled();
  });

  it('returns 400 AUTH_TOKEN_INVALID for an unknown/garbage token', async () => {
    const userRepo: MockUserRepo = {
      findByEmail: jest.fn(async () => null),
      markEmailVerified: jest.fn(),
    };
    const tokenRepo: MockTokenRepo = {
      create: jest.fn(),
      findValidByHash: jest.fn(async () => null),
      markConsumedIfActive: jest.fn(),
      invalidateActiveForUser: jest.fn(),
      lockForIssuance: jest.fn(),
    };
    const send = jest.fn<EmailProvider['send']>(async () => undefined);
    const app = buildApp(userRepo, tokenRepo, { send });

    const res = await request(app)
      .post('/api/v1/auth/verify-email')
      .send({ token: 'not-a-real-token' })
      .expect(400);

    expect(res.body.error.code).toBe('AUTH_TOKEN_INVALID');
    expect(userRepo.markEmailVerified).not.toHaveBeenCalled();
  });

  it('returns 400 AUTH_TOKEN_INVALID when the token is concurrently consumed before it can be claimed', async () => {
    const token = storedToken();
    const userRepo: MockUserRepo = {
      findByEmail: jest.fn(async () => null),
      markEmailVerified: jest.fn(),
    };
    const tokenRepo: MockTokenRepo = {
      create: jest.fn(),
      findValidByHash: jest.fn(async () => token),
      // Simulates a concurrent verify() winning the race and consuming the token first.
      markConsumedIfActive: jest.fn(async () => 0),
      invalidateActiveForUser: jest.fn(),
      lockForIssuance: jest.fn(),
    };
    const send = jest.fn<EmailProvider['send']>(async () => undefined);
    const app = buildApp(userRepo, tokenRepo, { send });

    const res = await request(app)
      .post('/api/v1/auth/verify-email')
      .send({ token: 'raw-token' })
      .expect(400);

    expect(res.body.error.code).toBe('AUTH_TOKEN_INVALID');
    expect(userRepo.markEmailVerified).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for a missing token body', async () => {
    const userRepo: MockUserRepo = { findByEmail: jest.fn(), markEmailVerified: jest.fn() };
    const tokenRepo: MockTokenRepo = {
      create: jest.fn(),
      findValidByHash: jest.fn(),
      markConsumedIfActive: jest.fn(),
      invalidateActiveForUser: jest.fn(),
      lockForIssuance: jest.fn(),
    };
    const app = buildApp(userRepo, tokenRepo, { send: jest.fn(async () => undefined) });

    const res = await request(app).post('/api/v1/auth/verify-email').send({}).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /api/v1/auth/resend-verification', () => {
  it('issues a new token and invalidates the prior one for a known unverified user', async () => {
    const user = storedUser();
    const userRepo: MockUserRepo = {
      findByEmail: jest.fn(async () => user),
      markEmailVerified: jest.fn(),
    };
    const tokenRepo: MockTokenRepo = {
      create: jest.fn(async () => storedToken()),
      findValidByHash: jest.fn(),
      markConsumedIfActive: jest.fn(),
      invalidateActiveForUser: jest.fn(async () => undefined),
      lockForIssuance: jest.fn(async () => undefined),
    };
    const send = jest.fn<EmailProvider['send']>(async () => undefined);
    const app = buildApp(userRepo, tokenRepo, { send });

    const beforeCall = Date.now();
    const res = await request(app)
      .post('/api/v1/auth/resend-verification')
      .send({ email: 'ada@example.com' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(tokenRepo.invalidateActiveForUser).toHaveBeenCalledWith(user.id, expect.anything());
    expect(tokenRepo.create).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ to: user.email, type: 'verification' }),
    );

    // Guard against regressions like persisting the raw token instead of its hash, or
    // breaking the TTL-to-milliseconds math: derive the raw token from the mocked mail body
    // and cross-check it against what was actually persisted.
    const sentBody = send.mock.calls[0]?.[0].body ?? '';
    const rawTokenSent = sentBody.split(': ').pop() ?? '';
    const persisted = tokenRepo.create.mock.calls[0]?.[0];
    expect(persisted?.tokenHash).toBe(hashToken(rawTokenSent));
    const expectedExpiry = beforeCall + env.EMAIL_VERIFICATION_TOKEN_TTL_MINUTES * 60_000;
    expect(persisted?.expiresAt.getTime()).toBeGreaterThan(expectedExpiry - 5_000);
    expect(persisted?.expiresAt.getTime()).toBeLessThan(expectedExpiry + 5_000);
  });

  it('returns the same generic 200 for an unknown email without sending mail', async () => {
    const userRepo: MockUserRepo = {
      findByEmail: jest.fn(async () => null),
      markEmailVerified: jest.fn(),
    };
    const tokenRepo: MockTokenRepo = {
      create: jest.fn(),
      findValidByHash: jest.fn(),
      markConsumedIfActive: jest.fn(),
      invalidateActiveForUser: jest.fn(),
      lockForIssuance: jest.fn(),
    };
    const send = jest.fn<EmailProvider['send']>(async () => undefined);
    const app = buildApp(userRepo, tokenRepo, { send });

    const res = await request(app)
      .post('/api/v1/auth/resend-verification')
      .send({ email: 'unknown@example.com' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(send).not.toHaveBeenCalled();
    expect(tokenRepo.create).not.toHaveBeenCalled();
  });

  it('returns the same generic 200 for an already-verified email without sending mail', async () => {
    const user = storedUser({ emailVerifiedAt: new Date('2026-08-01T00:00:00.000Z') });
    const userRepo: MockUserRepo = {
      findByEmail: jest.fn(async () => user),
      markEmailVerified: jest.fn(),
    };
    const tokenRepo: MockTokenRepo = {
      create: jest.fn(),
      findValidByHash: jest.fn(),
      markConsumedIfActive: jest.fn(),
      invalidateActiveForUser: jest.fn(),
      lockForIssuance: jest.fn(),
    };
    const send = jest.fn<EmailProvider['send']>(async () => undefined);
    const app = buildApp(userRepo, tokenRepo, { send });

    const knownRes = await request(app)
      .post('/api/v1/auth/resend-verification')
      .send({ email: 'ada@example.com' })
      .expect(200);
    const unknownRes = await request(app)
      .post('/api/v1/auth/resend-verification')
      .send({ email: 'unknown@example.com' })
      .expect(200);

    expect(knownRes.body).toEqual(unknownRes.body);
    expect(send).not.toHaveBeenCalled();
  });

  it('still returns the same generic 200 when issuing a new token fails for a known unverified user', async () => {
    const user = storedUser();
    const userRepo: MockUserRepo = {
      findByEmail: jest.fn(async () => user),
      markEmailVerified: jest.fn(),
    };
    const tokenRepo: MockTokenRepo = {
      create: jest.fn(async () => {
        throw new Error('db unavailable');
      }),
      findValidByHash: jest.fn(),
      markConsumedIfActive: jest.fn(),
      invalidateActiveForUser: jest.fn(async () => undefined),
      lockForIssuance: jest.fn(async () => undefined),
    };
    const send = jest.fn<EmailProvider['send']>(async () => undefined);
    const app = buildApp(userRepo, tokenRepo, { send });

    const res = await request(app)
      .post('/api/v1/auth/resend-verification')
      .send({ email: 'ada@example.com' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.message).toBe(
      'If an account with that email exists and needs verification, a new link has been sent.',
    );
  });
});
