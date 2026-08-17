import { describe, expect, it, jest } from '@jest/globals';
import type { PrismaClient, User } from '@prisma/client';
import request from 'supertest';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { AuthController } from './controllers/authController.js';
import { HealthController } from './controllers/healthController.js';
import type { EmailProvider } from './lib/email/emailProvider.js';
import { logger } from './lib/logger.js';
import { verifyPassword } from './lib/password.js';
import { hashToken } from './lib/token.js';
import type { EmailVerificationTokenRepository } from './repositories/emailVerificationTokenRepository.js';
import type { UserRepository } from './repositories/userRepository.js';
import { AuthService, type OnUserRegistered } from './services/authService.js';
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

function stubTokenRepo(): EmailVerificationTokenRepository {
  return {
    create: jest.fn(async () => ({
      id: 'token_1',
      userId: 'user_1',
      tokenHash: 'hash',
      expiresAt: new Date(),
      consumedAt: null,
      createdAt: new Date(),
    })),
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

/** Builds the app with the same wiring as server.ts: a real onUserRegistered hook that
 * calls issueAndSend and isolates provider failures, so a mocked EmailProvider.send can
 * be asserted directly. */
function registerApp(
  userRepository: UserRepository,
  options: { send?: jest.Mock<EmailProvider['send']>; tokenRepository?: EmailVerificationTokenRepository } = {},
) {
  const send = options.send ?? jest.fn(async () => undefined);
  const tokenRepository = options.tokenRepository ?? stubTokenRepo();
  const emailVerificationService = new EmailVerificationService(
    userRepository,
    tokenRepository,
    { send },
    fakePrisma(),
  );
  const onUserRegistered: OnUserRegistered = (user) =>
    emailVerificationService.issueAndSend(user).catch((err) => {
      logger.warn({ err }, 'verification email failed');
    });
  const authController = new AuthController(
    new AuthService(
      userRepository,
      onUserRegistered,
      stubRefreshRepo(),
      stubPasswordResetTokens() as never,
      fakePrisma(),
    ),
    emailVerificationService,
    { forgot: async () => undefined, reset: async () => undefined } as unknown as PasswordResetService,
  );
  return createApp({
    healthController: mockHealth(),
    authController,
  });
}

describe('POST /api/v1/auth/register', () => {
  it('creates a user with bcrypt cost-12 hash and public 201 envelope', async () => {
    const create = jest.fn(
      async (input: { email: string; passwordHash: string; name: string; systemRole: 'USER' }) =>
        storedUser({
          email: input.email,
          passwordHash: input.passwordHash,
          name: input.name,
        }),
    );
    const findByEmail = jest.fn<UserRepository['findByEmail']>(async () => null);
    const send = jest.fn<EmailProvider['send']>(async () => undefined);
    const tokenRepository = stubTokenRepo();
    const app = registerApp({ create, findByEmail } as unknown as UserRepository, {
      send,
      tokenRepository,
    });

    const plaintext = 'password1';
    const beforeCall = Date.now();
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ name: 'Ada Lovelace', email: 'Ada@Example.com', password: plaintext })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.user).toEqual({
      id: 'user_1',
      email: 'ada@example.com',
      name: 'Ada Lovelace',
      isActive: true,
      emailVerifiedAt: null,
      systemRole: 'USER',
      createdAt: '2026-08-14T00:00:00.000Z',
      updatedAt: '2026-08-14T00:00:00.000Z',
    });
    expect(res.body.data.user).not.toHaveProperty('password');
    expect(res.body.data.user).not.toHaveProperty('passwordHash');
    expect(JSON.stringify(res.body)).not.toContain(plaintext);

    expect(findByEmail).toHaveBeenCalledWith('ada@example.com');
    expect(create).toHaveBeenCalledTimes(1);
    const persisted = create.mock.calls[0]?.[0] as {
      passwordHash: string;
      email: string;
      systemRole: 'USER';
    };
    expect(persisted.email).toBe('ada@example.com');
    expect(persisted.systemRole).toBe('USER');
    expect(persisted.passwordHash).not.toBe(plaintext);
    expect(persisted.passwordHash).toMatch(/^\$2[aby]\$12\$/);
    await expect(verifyPassword(plaintext, persisted.passwordHash)).resolves.toBe(true);
    expect(tokenRepository.create).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ to: 'ada@example.com', type: 'verification' }),
    );

    // Guard against regressions like persisting the raw token instead of its hash, or
    // breaking the TTL-to-milliseconds math: derive the raw token from the mocked mail body
    // and cross-check it against what was actually persisted.
    const sentBody = send.mock.calls[0]?.[0].body ?? '';
    const rawTokenSent = sentBody.split(': ').pop() ?? '';
    const persistedToken = (tokenRepository.create as jest.Mock).mock.calls[0]?.[0] as {
      tokenHash: string;
      expiresAt: Date;
    };
    expect(persistedToken.tokenHash).toBe(hashToken(rawTokenSent));
    const expectedExpiry = beforeCall + env.EMAIL_VERIFICATION_TOKEN_TTL_MINUTES * 60_000;
    expect(persistedToken.expiresAt.getTime()).toBeGreaterThan(expectedExpiry - 5_000);
    expect(persistedToken.expiresAt.getTime()).toBeLessThan(expectedExpiry + 5_000);
  });

  it('still returns 201 when the email provider throws (send failure is isolated)', async () => {
    const create = jest.fn(
      async (input: { email: string; passwordHash: string; name: string; systemRole: 'USER' }) =>
        storedUser({ email: input.email, passwordHash: input.passwordHash, name: input.name }),
    );
    const findByEmail = jest.fn<UserRepository['findByEmail']>(async () => null);
    const send = jest.fn<EmailProvider['send']>(async () => {
      throw new Error('smtp unavailable');
    });
    const app = registerApp({ create, findByEmail } as unknown as UserRepository, { send });

    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ name: 'Ada', email: 'ada@example.com', password: 'password1' })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('rejects a password over the bcrypt 72-byte limit', async () => {
    const create = jest.fn();
    const findByEmail = jest.fn();
    const app = registerApp({ create, findByEmail } as unknown as UserRepository);

    const overLimit = 'a'.repeat(73);
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ name: 'Ada', email: 'ada@example.com', password: overLimit })
      .expect(400);

    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toEqual(
      expect.objectContaining({ password: expect.any(Array) }),
    );
    expect(create).not.toHaveBeenCalled();
    expect(findByEmail).not.toHaveBeenCalled();
  });

  it('accepts a password at exactly the 72-byte limit', async () => {
    const create = jest.fn(
      async (input: { email: string; passwordHash: string; name: string; systemRole: 'USER' }) =>
        storedUser({ email: input.email, passwordHash: input.passwordHash, name: input.name }),
    );
    const findByEmail = jest.fn<UserRepository['findByEmail']>(async () => null);
    const app = registerApp({ create, findByEmail } as unknown as UserRepository);

    const atLimit = 'a'.repeat(72);
    await request(app)
      .post('/api/v1/auth/register')
      .send({ name: 'Ada', email: 'ada@example.com', password: atLimit })
      .expect(201);

    expect(create).toHaveBeenCalledTimes(1);
  });

  it('ignores client-supplied systemRole/isActive fields (no mass assignment)', async () => {
    const create = jest.fn(
      async (input: { email: string; passwordHash: string; name: string; systemRole: 'USER' }) =>
        storedUser({ email: input.email, passwordHash: input.passwordHash, name: input.name }),
    );
    const findByEmail = jest.fn<UserRepository['findByEmail']>(async () => null);
    const app = registerApp({ create, findByEmail } as unknown as UserRepository);

    await request(app)
      .post('/api/v1/auth/register')
      .send({
        name: 'Ada Lovelace',
        email: 'ada@example.com',
        password: 'password1',
        systemRole: 'SUPER_ADMIN',
        isActive: false,
      })
      .expect(201);

    expect(create).toHaveBeenCalledTimes(1);
    const persisted = create.mock.calls[0]?.[0] as { systemRole: string };
    expect(persisted.systemRole).toBe('USER');
    expect(persisted).not.toHaveProperty('isActive');
  });

  it('returns VALIDATION_ERROR for duplicate email without extra account fields', async () => {
    const existing = storedUser();
    const create = jest.fn();
    const findByEmail = jest.fn(async () => existing);
    const app = registerApp({ create, findByEmail } as unknown as UserRepository);

    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ name: 'Ada', email: 'ADA@example.com', password: 'password1' })
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message.toLowerCase()).toMatch(/taken|already/);
    expect(res.body.error.details).toEqual({ email: ['This email is already taken'] });
    expect(JSON.stringify(res.body)).not.toContain(existing.id);
    expect(JSON.stringify(res.body)).not.toContain(existing.name);
    expect(JSON.stringify(res.body)).not.toContain(existing.passwordHash);
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
    expect(create).not.toHaveBeenCalled();
  });

  it('returns field details for invalid body and does not write', async () => {
    const create = jest.fn();
    const findByEmail = jest.fn();
    const app = registerApp({ create, findByEmail } as unknown as UserRepository);

    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ name: '', email: 'not-an-email', password: 'short' })
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toEqual(
      expect.objectContaining({
        name: expect.any(Array),
        email: expect.any(Array),
        password: expect.any(Array),
      }),
    );
    expect(create).not.toHaveBeenCalled();
    expect(findByEmail).not.toHaveBeenCalled();
  });

  it('still includes invalid-body details when NODE_ENV=production', async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const create = jest.fn();
      const findByEmail = jest.fn();
      const app = registerApp({ create, findByEmail } as unknown as UserRepository);

      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({ name: '', email: 'bad', password: 'short' })
        .expect(400);

      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details).toEqual(
        expect.objectContaining({
          name: expect.any(Array),
          email: expect.any(Array),
          password: expect.any(Array),
        }),
      );
      expect(create).not.toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = previous;
    }
  });
});
