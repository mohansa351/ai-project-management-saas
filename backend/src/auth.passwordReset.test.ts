import { describe, expect, it, jest } from '@jest/globals';
import type { PasswordResetToken, PrismaClient, RefreshToken, User } from '@prisma/client';
import type { RequestHandler } from 'express';
import request from 'supertest';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { AuthController } from './controllers/authController.js';
import { HealthController } from './controllers/healthController.js';
import type { EmailProvider, EmailMessage } from './lib/email/emailProvider.js';
import { AUTH_SESSION_UNAUTHORIZED_MESSAGE } from './lib/http/authErrors.js';
import { AppError } from './lib/http/appError.js';
import { hashPassword, verifyPassword } from './lib/password.js';
import { hashToken } from './lib/token.js';
import type { EmailVerificationTokenRepository } from './repositories/emailVerificationTokenRepository.js';
import type { PasswordResetTokenRepository } from './repositories/passwordResetTokenRepository.js';
import type { RefreshTokenRepository } from './repositories/refreshTokenRepository.js';
import type { UserRepository } from './repositories/userRepository.js';
import { AuthService } from './services/authService.js';
import { EmailVerificationService } from './services/emailVerificationService.js';
import type { HealthService } from './services/healthService.js';
import { PasswordResetService } from './services/passwordResetService.js';

const now = new Date('2026-08-14T00:00:00.000Z');
const OLD_PASSWORD = 'oldpass12';
const NEW_PASSWORD = 'newpass12';
const GENERIC_FORGOT = 'If an account with that email exists, a reset link has been sent.';
const RESET_OK = 'Password has been reset. Sign in with your new password.';
const RESET_INVALID = 'This reset link is invalid or has expired.';

function fakePrisma(): PrismaClient {
  return {
    $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn({})),
  } as unknown as PrismaClient;
}

function serialPrisma(): PrismaClient {
  let tail = Promise.resolve();
  return {
    $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => {
      const run = tail.then(() => fn({}));
      tail = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    }),
  } as unknown as PrismaClient;
}

/** Commits callback mutations only when the callback resolves. Throws restore `snapshot`. */
function rollbackAwarePrisma(snapshot: () => unknown, restore: (state: unknown) => void): PrismaClient {
  return {
    $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => {
      const state = snapshot();
      try {
        return await fn({});
      } catch (err) {
        restore(state);
        throw err;
      }
    }),
  } as unknown as PrismaClient;
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

function mockHealth(): HealthController {
  return new HealthController({
    getReadiness: jest.fn(async () => ({ status: 'ok', postgres: 'up', redis: 'up', uptime: 1 })),
  } as unknown as HealthService);
}

function stubEmailTokens(): EmailVerificationTokenRepository {
  return {
    create: jest.fn(),
    findValidByHash: jest.fn(async () => null),
    markConsumedIfActive: jest.fn(async () => 0),
    invalidateActiveForUser: jest.fn(async () => undefined),
    lockForIssuance: jest.fn(async () => undefined),
  } as unknown as EmailVerificationTokenRepository;
}

function cookieHeader(res: request.Response, name: string): string | undefined {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list.find((line) => line.startsWith(`${name}=`));
}

function isClearCookie(header: string | undefined): boolean {
  if (!header) {
    return false;
  }
  return /refresh_token=;/i.test(header) || /Expires=Thu, 01 Jan 1970/i.test(header);
}

function extractToken(body: string): string {
  const match = body.match(/password: ([a-f0-9]{64})/);
  if (!match?.[1]) {
    throw new Error('token missing from mail body');
  }
  return match[1];
}

type ResetStore = Map<string, PasswordResetToken>;

function memoryResetRepo(store: ResetStore): PasswordResetTokenRepository {
  return {
    lockForUser: jest.fn(async () => undefined),
    invalidateUnusedForUser: jest.fn(async (userId: string) => {
      for (const row of store.values()) {
        if (row.userId === userId && row.usedAt === null) {
          row.usedAt = new Date();
        }
      }
    }),
    create: jest.fn(async (input: { userId: string; tokenHash: string; expiresAt: Date }) => {
      const row: PasswordResetToken = {
        id: `prt_${store.size + 1}`,
        userId: input.userId,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
        usedAt: null,
        createdAt: new Date(),
      };
      store.set(row.tokenHash, row);
      return row;
    }),
    findValidByHash: jest.fn(async (tokenHash: string) => {
      const row = store.get(tokenHash);
      if (!row || row.usedAt !== null || row.expiresAt <= new Date()) {
        return null;
      }
      return row;
    }),
    markUsedIfActive: jest.fn(async (id: string) => {
      const row = [...store.values()].find((item) => item.id === id);
      if (!row || row.usedAt !== null || row.expiresAt <= new Date()) {
        return 0;
      }
      row.usedAt = new Date();
      return 1;
    }),
  } as unknown as PasswordResetTokenRepository;
}

type RefreshStore = Map<string, RefreshToken>;

function memoryRefreshRepo(store: RefreshStore): RefreshTokenRepository {
  return {
    create: jest.fn(async (input: { userId: string; tokenHash: string; expiresAt: Date; userAgent?: string }) => {
      const row: RefreshToken = {
        id: `rt_${store.size + 1}`,
        userId: input.userId,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
        revokedAt: null,
        replacedByHash: null,
        userAgent: input.userAgent ?? null,
        createdAt: new Date(),
      };
      store.set(row.tokenHash, row);
      return row;
    }),
    revokeByHash: jest.fn(async (tokenHash: string) => {
      const row = store.get(tokenHash);
      if (!row || row.revokedAt !== null || row.expiresAt <= new Date()) {
        return 0;
      }
      row.revokedAt = new Date();
      return 1;
    }),
    revokeAllLiveForUser: jest.fn(async (userId: string) => {
      let count = 0;
      for (const row of store.values()) {
        if (row.userId === userId && row.revokedAt === null && row.expiresAt > new Date()) {
          row.revokedAt = new Date();
          count += 1;
        }
      }
      return count;
    }),
    lockForRotation: jest.fn(async () => undefined),
    findByHash: jest.fn(async (tokenHash: string) => store.get(tokenHash) ?? null),
    claimRotation: jest.fn(async () => 0),
    revokeLiveLeafOfChain: jest.fn(async () => null),
  } as unknown as RefreshTokenRepository;
}

function seedRefresh(store: RefreshStore, tokenHash: string, userId = 'user_1'): RefreshToken {
  const row: RefreshToken = {
    id: `rt_${tokenHash}`,
    userId,
    tokenHash,
    expiresAt: new Date('2026-09-01T00:00:00.000Z'),
    revokedAt: null,
    replacedByHash: null,
    userAgent: null,
    createdAt: now,
  };
  store.set(tokenHash, row);
  return row;
}

type Harness = {
  app: ReturnType<typeof createApp>;
  user: User;
  resetStore: ResetStore;
  refreshStore: RefreshStore;
  send: jest.Mock<EmailProvider['send']>;
  markUsedIfActive: jest.Mock;
};

async function buildHarness(
  overrides: Partial<User> = {},
  prisma: PrismaClient = fakePrisma(),
  authRateLimit?: RequestHandler,
): Promise<Harness> {
  const passwordHash = overrides.passwordHash ?? (await hashPassword(OLD_PASSWORD));
  const user = storedUser({ passwordHash, ...overrides });
  const resetStore: ResetStore = new Map();
  const refreshStore: RefreshStore = new Map();
  const resetRepo = memoryResetRepo(resetStore);
  const refreshRepo = memoryRefreshRepo(refreshStore);
  const send = jest.fn<EmailProvider['send']>(async () => undefined);
  const userRepository = {
    findByEmail: jest.fn(async (email: string) => (email === user.email ? user : null)),
    findById: jest.fn(async (id: string) => (id === user.id ? user : null)),
    casSessionEpoch: jest.fn(async () => 1),
    updatePasswordAndBumpEpoch: jest.fn(async (_id: string, nextHash: string) => {
      user.passwordHash = nextHash;
      user.sessionEpoch += 1;
      return user;
    }),
  } as unknown as UserRepository;

  const authController = new AuthController(
    new AuthService(userRepository, async () => undefined, refreshRepo, resetRepo, prisma),
    new EmailVerificationService(userRepository, stubEmailTokens(), { send: jest.fn(async () => undefined) }, prisma),
    new PasswordResetService(userRepository, resetRepo, refreshRepo, { send }, prisma),
  );

  return {
    app: createApp({ healthController: mockHealth(), authController, authRateLimit }),
    user,
    resetStore,
    refreshStore,
    send,
    markUsedIfActive: resetRepo.markUsedIfActive as unknown as jest.Mock,
  };
}

describe('POST /api/v1/auth/forgot-password', () => {
  it('sends password-reset mail and persists a hashed live token for an active user', async () => {
    const { app, send, resetStore, user } = await buildHarness();
    const res = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'Ada@Example.com' })
      .expect(200);

    expect(res.body).toEqual({ success: true, data: { message: GENERIC_FORGOT } });
    expect(send).toHaveBeenCalledTimes(1);
    const mail = send.mock.calls[0]?.[0] as EmailMessage;
    expect(mail.type).toBe('password-reset');
    expect(mail.to).toBe(user.email);
    const raw = extractToken(mail.body);
    expect(mail.body).toContain(`${env.CORS_ORIGIN}/reset-password?token=${raw}`);
    expect(resetStore.size).toBe(1);
    const row = [...resetStore.values()][0];
    expect(row?.tokenHash).toBe(hashToken(raw));
    expect(row?.tokenHash).not.toBe(raw);
    expect(row?.usedAt).toBeNull();
    expect(row?.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(row?.expiresAt.getTime()).toBeLessThanOrEqual(
      Date.now() + env.PASSWORD_RESET_TOKEN_TTL_MINUTES * 60_000 + 1000,
    );
  });

  it('returns the same generic 200 for unknown and inactive emails without sending mail', async () => {
    const known = await buildHarness();
    const unknown = await request(known.app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'missing@example.com' })
      .expect(200);
    const inactiveHarness = await buildHarness({ isActive: false });
    const inactive = await request(inactiveHarness.app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'ada@example.com' })
      .expect(200);

    expect(unknown.body).toEqual(inactive.body);
    expect(unknown.body.data.message).toBe(GENERIC_FORGOT);
    expect(known.send).not.toHaveBeenCalled();
    expect(inactiveHarness.send).not.toHaveBeenCalled();
    expect(known.resetStore.size).toBe(0);
    expect(inactiveHarness.resetStore.size).toBe(0);
  });

  it('invalidates the prior token when forgot is called twice', async () => {
    const { app, send } = await buildHarness();
    await request(app).post('/api/v1/auth/forgot-password').send({ email: 'ada@example.com' }).expect(200);
    const first = extractToken((send.mock.calls[0]?.[0] as EmailMessage).body);
    await request(app).post('/api/v1/auth/forgot-password').send({ email: 'ada@example.com' }).expect(200);
    const second = extractToken((send.mock.calls[1]?.[0] as EmailMessage).body);

    const firstReset = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: first, password: NEW_PASSWORD })
      .expect(400);
    expect(firstReset.body.error.code).toBe('AUTH_TOKEN_INVALID');
    await request(app).post('/api/v1/auth/reset-password').send({ token: second, password: NEW_PASSWORD }).expect(200);
  });

  it('still returns generic 200 when send throws for a known user and keeps the hashed row', async () => {
    const { app, send, resetStore } = await buildHarness();
    send.mockImplementation(async () => {
      throw new Error('smtp down');
    });
    const res = await request(app).post('/api/v1/auth/forgot-password').send({ email: 'ada@example.com' }).expect(200);
    expect(res.body.data.message).toBe(GENERIC_FORGOT);
    expect(resetStore.size).toBe(1);
    expect([...resetStore.values()][0]?.usedAt).toBeNull();
  });

  it('sends reset mail for an unverified active user', async () => {
    const { app, send, resetStore } = await buildHarness({ emailVerifiedAt: null });
    await request(app).post('/api/v1/auth/forgot-password').send({ email: 'ada@example.com' }).expect(200);
    expect(send).toHaveBeenCalledTimes(1);
    expect(resetStore.size).toBe(1);
  });

  it('returns VALIDATION_ERROR for an invalid email body', async () => {
    const { app } = await buildHarness();
    const res = await request(app).post('/api/v1/auth/forgot-password').send({ email: 'not-an-email' }).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toBeDefined();
  });

  it('ignores Authorization Bearer on forgot', async () => {
    const { app, send } = await buildHarness();
    await request(app)
      .post('/api/v1/auth/forgot-password')
      .set('Authorization', 'Bearer totally-not-a-jwt')
      .send({ email: 'ada@example.com' })
      .expect(200);
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/v1/auth/reset-password', () => {
  async function issueToken(harness: Harness): Promise<string> {
    await request(harness.app).post('/api/v1/auth/forgot-password').send({ email: 'ada@example.com' }).expect(200);
    return extractToken((harness.send.mock.calls.at(-1)?.[0] as EmailMessage).body);
  }

  it('sets a new bcrypt hash, marks the token used, bumps epoch, and revokes all live refresh rows', async () => {
    const harness = await buildHarness();
    seedRefresh(harness.refreshStore, hashToken('device-a'));
    seedRefresh(harness.refreshStore, hashToken('device-b'));
    const token = await issueToken(harness);
    const oldHash = harness.user.passwordHash;
    const verifiedAt = harness.user.emailVerifiedAt;

    const res = await request(harness.app)
      .post('/api/v1/auth/reset-password')
      .set('Cookie', 'refresh_token=stale-session')
      .send({ token, password: NEW_PASSWORD })
      .expect(200);

    expect(res.body).toEqual({ success: true, data: { message: RESET_OK } });
    expect(res.body.data).not.toHaveProperty('accessToken');
    expect(isClearCookie(cookieHeader(res, 'refresh_token'))).toBe(true);
    expect(harness.user.passwordHash).not.toBe(oldHash);
    expect(await verifyPassword(NEW_PASSWORD, harness.user.passwordHash)).toBe(true);
    expect(await verifyPassword(OLD_PASSWORD, harness.user.passwordHash)).toBe(false);
    expect(harness.user.sessionEpoch).toBe(1);
    expect(harness.user.emailVerifiedAt).toEqual(verifiedAt);
    expect([...harness.resetStore.values()][0]?.usedAt).not.toBeNull();
    expect([...harness.refreshStore.values()].every((row) => row.revokedAt !== null)).toBe(true);

    await request(harness.app)
      .post('/api/v1/auth/login')
      .send({ email: 'ada@example.com', password: OLD_PASSWORD })
      .expect(401);
    const login = await request(harness.app)
      .post('/api/v1/auth/login')
      .send({ email: 'ada@example.com', password: NEW_PASSWORD })
      .expect(200);
    expect(login.body.data.accessToken).toEqual(expect.any(String));
    expect(cookieHeader(login, 'refresh_token')).toBeDefined();
  });

  it('keeps EMAIL_NOT_VERIFIED after reset for an unverified user', async () => {
    const harness = await buildHarness({ emailVerifiedAt: null });
    const token = await issueToken(harness);
    await request(harness.app).post('/api/v1/auth/reset-password').send({ token, password: NEW_PASSWORD }).expect(200);
    const login = await request(harness.app)
      .post('/api/v1/auth/login')
      .send({ email: 'ada@example.com', password: NEW_PASSWORD })
      .expect(403);
    expect(login.body.error.code).toBe('EMAIL_NOT_VERIFIED');
    expect(cookieHeader(login, 'refresh_token')).toBeUndefined();
    expect(harness.user.emailVerifiedAt).toBeNull();
  });

  it('rejects refresh with a pre-reset cookie after password reset', async () => {
    const harness = await buildHarness();
    const raw = 'r'.repeat(64);
    seedRefresh(harness.refreshStore, hashToken(raw));
    const token = await issueToken(harness);
    await request(harness.app).post('/api/v1/auth/reset-password').send({ token, password: NEW_PASSWORD }).expect(200);
    const refresh = await request(harness.app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', `refresh_token=${raw}`)
      .expect(401);
    expect(refresh.body.error.message).toBe(AUTH_SESSION_UNAUTHORIZED_MESSAGE);
    expect(refresh.body.data).toBeUndefined();
    expect(harness.refreshStore.get(hashToken(raw))?.revokedAt).not.toBeNull();
  });

  it('returns AUTH_TOKEN_INVALID for reused, expired, and unknown tokens', async () => {
    const harness = await buildHarness();
    const token = await issueToken(harness);
    await request(harness.app).post('/api/v1/auth/reset-password').send({ token, password: NEW_PASSWORD }).expect(200);
    const reuse = await request(harness.app)
      .post('/api/v1/auth/reset-password')
      .set('Cookie', 'refresh_token=x')
      .send({ token, password: NEW_PASSWORD })
      .expect(400);
    expect(reuse.body.error.code).toBe('AUTH_TOKEN_INVALID');
    expect(reuse.body.error.message).toBe(RESET_INVALID);
    expect(isClearCookie(cookieHeader(reuse, 'refresh_token'))).toBe(true);

    const unknown = await request(harness.app)
      .post('/api/v1/auth/reset-password')
      .send({ token: 'a'.repeat(64), password: NEW_PASSWORD })
      .expect(400);
    expect(unknown.body.error.code).toBe('AUTH_TOKEN_INVALID');
    expect(unknown.body.error.message).toBe(RESET_INVALID);

    const expiredHarness = await buildHarness();
    const expiredToken = await issueToken(expiredHarness);
    const expiredRow = [...expiredHarness.resetStore.values()][0];
    if (expiredRow) {
      expiredRow.expiresAt = new Date('2020-01-01T00:00:00.000Z');
    }
    const expired = await request(expiredHarness.app)
      .post('/api/v1/auth/reset-password')
      .send({ token: expiredToken, password: NEW_PASSWORD })
      .expect(400);
    expect(expired.body.error.code).toBe('AUTH_TOKEN_INVALID');
    expect(expiredHarness.user.sessionEpoch).toBe(0);
  });

  it('consumes an inactive leftover token even when AUTH_TOKEN_INVALID is returned (rollback-aware tx)', async () => {
    const passwordHash = await hashPassword(OLD_PASSWORD);
    const user = storedUser({ isActive: false, passwordHash, emailVerifiedAt: now, sessionEpoch: 0 });
    const inactiveToken = 'b'.repeat(64);
    const leftover: PasswordResetToken = {
      id: 'leftover',
      userId: 'user_1',
      tokenHash: hashToken(inactiveToken),
      expiresAt: new Date('2026-09-01T00:00:00.000Z'),
      usedAt: null,
      createdAt: now,
    };
    const resetStore: ResetStore = new Map([[leftover.tokenHash, leftover]]);
    const refreshStore: RefreshStore = new Map();
    const liveRefresh = seedRefresh(refreshStore, hashToken('still-live'));

    const snapshot = () => ({
      usedAt: leftover.usedAt,
      passwordHash: user.passwordHash,
      sessionEpoch: user.sessionEpoch,
      emailVerifiedAt: user.emailVerifiedAt,
      refreshRevokedAt: liveRefresh.revokedAt,
    });
    const restore = (state: unknown) => {
      const s = state as ReturnType<typeof snapshot>;
      leftover.usedAt = s.usedAt;
      user.passwordHash = s.passwordHash;
      user.sessionEpoch = s.sessionEpoch;
      user.emailVerifiedAt = s.emailVerifiedAt;
      liveRefresh.revokedAt = s.refreshRevokedAt;
    };

    const prisma = rollbackAwarePrisma(snapshot, restore);
    const resetRepo = memoryResetRepo(resetStore);
    const refreshRepo = memoryRefreshRepo(refreshStore);
    const userRepository = {
      findByEmail: jest.fn(async () => user),
      findById: jest.fn(async () => user),
      casSessionEpoch: jest.fn(async () => 1),
      updatePasswordAndBumpEpoch: jest.fn(async (_id: string, nextHash: string) => {
        user.passwordHash = nextHash;
        user.sessionEpoch += 1;
        return user;
      }),
    } as unknown as UserRepository;
    const authController = new AuthController(
      new AuthService(userRepository, async () => undefined, refreshRepo, resetRepo, prisma),
      new EmailVerificationService(userRepository, stubEmailTokens(), { send: jest.fn(async () => undefined) }, prisma),
      new PasswordResetService(userRepository, resetRepo, refreshRepo, { send: jest.fn(async () => undefined) }, prisma),
    );
    const app = createApp({ healthController: mockHealth(), authController });

    const first = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: inactiveToken, password: NEW_PASSWORD })
      .expect(400);

    expect(first.body.error.code).toBe('AUTH_TOKEN_INVALID');
    expect(first.body.error.message).toBe(RESET_INVALID);
    expect(leftover.usedAt).not.toBeNull();
    expect(user.passwordHash).toBe(passwordHash);
    expect(user.sessionEpoch).toBe(0);
    expect(user.emailVerifiedAt).toEqual(now);
    expect(liveRefresh.revokedAt).toBeNull();
    expect(await verifyPassword(OLD_PASSWORD, user.passwordHash)).toBe(true);

    user.isActive = true;
    const second = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: inactiveToken, password: NEW_PASSWORD })
      .expect(400);
    expect(second.body.error.code).toBe('AUTH_TOKEN_INVALID');
    expect(user.passwordHash).toBe(passwordHash);
    expect(user.sessionEpoch).toBe(0);
    expect(liveRefresh.revokedAt).toBeNull();
  });

  it('returns VALIDATION_ERROR for empty token or short password', async () => {
    const { app } = await buildHarness();
    const empty = await request(app).post('/api/v1/auth/reset-password').send({ token: '', password: NEW_PASSWORD });
    expect(empty.status).toBe(400);
    expect(empty.body.error.code).toBe('VALIDATION_ERROR');
    const short = await request(app).post('/api/v1/auth/reset-password').send({ token: 'abc', password: 'short' });
    expect(short.status).toBe(400);
    expect(short.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('allows only one winner among concurrent resets of the same token', async () => {
    let consumeCalls = 0;
    const passwordHash = await hashPassword(OLD_PASSWORD);
    const user = storedUser({ passwordHash });
    const prisma = serialPrisma();
    const markUsedIfActive = jest.fn(async () => {
      consumeCalls += 1;
      return consumeCalls === 1 ? 1 : 0;
    });
    const resetRepo = {
      lockForUser: jest.fn(async () => undefined),
      invalidateUnusedForUser: jest.fn(async () => undefined),
      create: jest.fn(),
      findValidByHash: jest.fn(async () => ({
        id: 'prt_1',
        userId: 'user_1',
        tokenHash: hashToken('same-token'),
        expiresAt: new Date('2026-09-01T00:00:00.000Z'),
        usedAt: null,
        createdAt: now,
      })),
      markUsedIfActive,
    } as unknown as PasswordResetTokenRepository;
    const refreshRepo = memoryRefreshRepo(new Map());
    const userRepository = {
      findByEmail: jest.fn(async () => user),
      findById: jest.fn(async () => user),
      casSessionEpoch: jest.fn(async () => 1),
      updatePasswordAndBumpEpoch: jest.fn(async (_id: string, nextHash: string) => {
        user.passwordHash = nextHash;
        user.sessionEpoch += 1;
        return user;
      }),
    } as unknown as UserRepository;
    const authController = new AuthController(
      new AuthService(userRepository, async () => undefined, refreshRepo, resetRepo, prisma),
      new EmailVerificationService(userRepository, stubEmailTokens(), { send: jest.fn(async () => undefined) }, prisma),
      new PasswordResetService(userRepository, resetRepo, refreshRepo, { send: jest.fn(async () => undefined) }, prisma),
    );
    const app = createApp({ healthController: mockHealth(), authController });

    const [first, second] = await Promise.all([
      request(app).post('/api/v1/auth/reset-password').send({ token: 'same-token', password: NEW_PASSWORD }),
      request(app).post('/api/v1/auth/reset-password').send({ token: 'same-token', password: 'otherpass99' }),
    ]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 400]);
    expect(user.sessionEpoch).toBe(1);
  });

  it('treats a nonempty garbage token as AUTH_TOKEN_INVALID not VALIDATION_ERROR', async () => {
    const { app } = await buildHarness();
    const res = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: 'not-a-real-token', password: NEW_PASSWORD })
      .expect(400);
    expect(res.body.error.code).toBe('AUTH_TOKEN_INVALID');
    expect(res.body.error.message).toBe(RESET_INVALID);
  });

  it('does not Clear-Cookie on VALIDATION_ERROR', async () => {
    const { app } = await buildHarness();
    const res = await request(app)
      .post('/api/v1/auth/reset-password')
      .set('Cookie', 'refresh_token=keep-me')
      .send({ token: '', password: NEW_PASSWORD })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(cookieHeader(res, 'refresh_token')).toBeUndefined();
  });

  it('ignores Authorization and query-string token; reads JSON body only', async () => {
    const harness = await buildHarness();
    const token = await issueToken(harness);
    const res = await request(harness.app)
      .post('/api/v1/auth/reset-password?token=wrong-query-token')
      .set('Authorization', 'Bearer totally-not-a-jwt')
      .send({ token, password: NEW_PASSWORD })
      .expect(200);
    expect(res.body.data.message).toBe(RESET_OK);
    expect(cookieHeader(res, 'refresh_token')).toBeUndefined();
  });

  it('allows resetting to the same password and still kills sessions', async () => {
    const harness = await buildHarness();
    seedRefresh(harness.refreshStore, hashToken('device-a'));
    const token = await issueToken(harness);
    await request(harness.app)
      .post('/api/v1/auth/reset-password')
      .send({ token, password: OLD_PASSWORD })
      .expect(200);
    expect(harness.user.sessionEpoch).toBe(1);
    expect([...harness.refreshStore.values()][0]?.revokedAt).not.toBeNull();
    expect(await verifyPassword(OLD_PASSWORD, harness.user.passwordHash)).toBe(true);
  });

  it('rate-limits forgot and reset when a limiter is injected', async () => {
    const limiter: RequestHandler = (_req, _res, next) => {
      next(new AppError('RATE_LIMITED', 'Too many requests. Try again later.', 429));
    };
    const { app } = await buildHarness({}, fakePrisma(), limiter);
    const forgot = await request(app).post('/api/v1/auth/forgot-password').send({ email: 'ada@example.com' }).expect(429);
    const reset = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: 'abc', password: NEW_PASSWORD })
      .expect(429);
    expect(forgot.body.error.code).toBe('RATE_LIMITED');
    expect(reset.body.error.code).toBe('RATE_LIMITED');
  });
});
