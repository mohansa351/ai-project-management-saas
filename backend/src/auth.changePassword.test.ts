import { beforeAll, describe, expect, it, jest } from '@jest/globals';
import type { PasswordResetToken, PrismaClient, RefreshToken, User } from '@prisma/client';
import type { RequestHandler } from 'express';
import { jwtVerify } from 'jose';
import request from 'supertest';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { AuthController } from './controllers/authController.js';
import { HealthController } from './controllers/healthController.js';
import { dummyOrganizationController } from './controllers/organizationController.js';
import { AppError } from './lib/http/appError.js';
import { AUTH_SESSION_UNAUTHORIZED_MESSAGE } from './lib/http/authErrors.js';
import { signAccessToken } from './lib/jwt.js';
import { hashPassword, verifyPassword } from './lib/password.js';
import { generateToken, hashToken } from './lib/token.js';
import { createRequireAccessToken } from './middleware/requireAccessToken.js';
import type { EmailVerificationTokenRepository } from './repositories/emailVerificationTokenRepository.js';
import type { PasswordResetTokenRepository } from './repositories/passwordResetTokenRepository.js';
import type { RefreshTokenRepository } from './repositories/refreshTokenRepository.js';
import type { UserRepository } from './repositories/userRepository.js';
import { AuthService } from './services/authService.js';
import { EmailVerificationService } from './services/emailVerificationService.js';
import { PasswordResetService } from './services/passwordResetService.js';
import type { HealthService } from './services/healthService.js';

const CURRENT = 'oldpass12';
const NEXT = 'newpass12';
const now = new Date('2026-08-14T00:00:00.000Z');
const future = new Date('2026-09-01T00:00:00.000Z');

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

function cookieValue(header: string): string {
  const pair = header.split(';')[0] ?? '';
  const eq = pair.indexOf('=');
  return eq >= 0 ? pair.slice(eq + 1) : '';
}

function isClearCookie(header: string | undefined): boolean {
  if (!header) {
    return false;
  }
  return /refresh_token=;/i.test(header) || /Expires=Thu, 01 Jan 1970/i.test(header);
}

type RefreshStore = Map<string, RefreshToken>;
type ResetStore = Map<string, PasswordResetToken>;

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
    claimRotation: jest.fn(async (tokenHash: string, successorHash: string) => {
      const row = store.get(tokenHash);
      if (!row || row.revokedAt !== null || row.expiresAt <= new Date()) {
        return 0;
      }
      row.revokedAt = new Date();
      row.replacedByHash = successorHash;
      return 1;
    }),
    revokeLiveLeafOfChain: jest.fn(async () => null),
  } as unknown as RefreshTokenRepository;
}

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

function seedRefresh(store: RefreshStore, tokenHash: string, userId = 'user_1'): RefreshToken {
  const row: RefreshToken = {
    id: `rt_${tokenHash}`,
    userId,
    tokenHash,
    expiresAt: future,
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
  refreshStore: RefreshStore;
  resetStore: ResetStore;
  refreshRepo: RefreshTokenRepository;
  resetRepo: PasswordResetTokenRepository;
  userRepository: UserRepository;
};

async function buildHarness(
  overrides: Partial<User> = {},
  prisma: PrismaClient = fakePrisma(),
  authRateLimit?: RequestHandler,
): Promise<Harness> {
  const passwordHash = overrides.passwordHash ?? (await hashPassword(CURRENT));
  const user = storedUser({ passwordHash, ...overrides });
  const refreshStore: RefreshStore = new Map();
  const resetStore: ResetStore = new Map();
  const refreshRepo = memoryRefreshRepo(refreshStore);
  const resetRepo = memoryResetRepo(resetStore);
  const userRepository = {
    findByEmail: jest.fn(async (email: string) => (email === user.email ? user : null)),
    findById: jest.fn(async (id: string) => (id === user.id ? user : null)),
    casSessionEpoch: jest.fn(async (id: string, expected: number) =>
      id === user.id && user.sessionEpoch === expected ? 1 : 0,
    ),
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

  return {
    app: createApp({
      healthController: mockHealth(),
      authController,
      organizationController: dummyOrganizationController(),
      authRateLimit,
      requireAccessToken: createRequireAccessToken(userRepository),
    }),
    user,
    refreshStore,
    resetStore,
    refreshRepo,
    resetRepo,
    userRepository,
  };
}

describe('POST /api/v1/auth/change-password', () => {
  let passwordHash: string;

  beforeAll(async () => {
    passwordHash = await hashPassword(CURRENT);
  });

  it('changes password, revokes prior refresh rows, reissues cookie + access JWT', async () => {
    const harness = await buildHarness({ passwordHash });
    const deviceA = seedRefresh(harness.refreshStore, hashToken('device-a'));
    const deviceB = seedRefresh(harness.refreshStore, hashToken('device-b'));
    const resetRaw = generateToken();
    harness.resetStore.set(hashToken(resetRaw), {
      id: 'prt_1',
      userId: 'user_1',
      tokenHash: hashToken(resetRaw),
      expiresAt: future,
      usedAt: null,
      createdAt: now,
    });

    const access = await signAccessToken({ sub: 'user_1', email: 'ada@example.com', systemRole: 'USER' });

    const res = await request(harness.app)
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${access}`)
      .set('User-Agent', 'Story26Browser/1.0')
      .set('Cookie', 'refresh_token=device-a')
      .send({ currentPassword: CURRENT, newPassword: NEXT })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.user).not.toHaveProperty('passwordHash');
    expect(res.body.data).not.toHaveProperty('refreshToken');
    expect(res.body.data.user.id).toBe('user_1');

    const verified = await jwtVerify(
      res.body.data.accessToken as string,
      new TextEncoder().encode(env.JWT_ACCESS_SECRET),
    );
    expect(verified.payload.sub).toBe('user_1');
    expect(verified.payload).not.toHaveProperty('sessionEpoch');

    const setCookie = cookieHeader(res, 'refresh_token');
    expect(setCookie).toBeDefined();
    expect(isClearCookie(setCookie)).toBe(false);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).toMatch(/Path=\/api\/v1/i);
    const newRaw = cookieValue(setCookie!);
    expect(newRaw).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(res.body)).not.toContain(newRaw);

    expect(deviceA.revokedAt).not.toBeNull();
    expect(deviceB.revokedAt).not.toBeNull();
    expect(deviceA.replacedByHash).toBeNull();
    const reissued = harness.refreshStore.get(hashToken(newRaw));
    expect(reissued).toBeDefined();
    expect(reissued?.revokedAt).toBeNull();
    expect(reissued?.userAgent).toBe('Story26Browser/1.0');

    expect(harness.user.sessionEpoch).toBe(1);
    expect(await verifyPassword(NEXT, harness.user.passwordHash)).toBe(true);
    expect(await verifyPassword(CURRENT, harness.user.passwordHash)).toBe(false);

    const resetRow = harness.resetStore.get(hashToken(resetRaw));
    expect(resetRow?.usedAt).not.toBeNull();

    await request(harness.app)
      .post('/api/v1/auth/reset-password')
      .send({ token: resetRaw, password: 'another99' })
      .expect(400);

    await request(harness.app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', 'refresh_token=device-a')
      .expect(401);

    const refreshOk = await request(harness.app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', `refresh_token=${newRaw}`)
      .expect(200);
    expect(refreshOk.body.data.accessToken).toBeDefined();
  });

  it('accepts bearer scheme case-insensitively', async () => {
    const harness = await buildHarness({ passwordHash });
    const access = await signAccessToken({ sub: 'user_1', email: 'ada@example.com', systemRole: 'USER' });

    await request(harness.app)
      .post('/api/v1/auth/change-password')
      .set('Authorization', `bearer ${access}`)
      .send({ currentPassword: CURRENT, newPassword: NEXT })
      .expect(200);
  });

  it('returns 401 AUTH_UNAUTHORIZED for wrong current password without mutating sessions', async () => {
    const access = await signAccessToken({ sub: 'user_1', email: 'ada@example.com', systemRole: 'USER' });

    let passwordHashState = passwordHash;
    let sessionEpoch = 0;
    let refreshRevokedAt: Date | null = null;
    const liveHash = hashToken('keep-me');

    const snapshot = () => ({
      passwordHashState,
      sessionEpoch,
      refreshRevokedAt,
    });
    const restore = (state: unknown) => {
      const s = state as ReturnType<typeof snapshot>;
      passwordHashState = s.passwordHashState;
      sessionEpoch = s.sessionEpoch;
      refreshRevokedAt = s.refreshRevokedAt;
    };
    const prisma = rollbackAwarePrisma(snapshot, restore);

    const user = storedUser({ passwordHash: passwordHashState, sessionEpoch });
    const refreshStore: RefreshStore = new Map();
    const live = seedRefresh(refreshStore, liveHash);
    Object.defineProperty(live, 'revokedAt', {
      get: () => refreshRevokedAt,
      set: (v: Date | null) => {
        refreshRevokedAt = v;
      },
      configurable: true,
    });

    const resetRepo = memoryResetRepo(new Map());
    const refreshRepo = memoryRefreshRepo(refreshStore);
    const userRepository = {
      findByEmail: jest.fn(async () => user),
      findById: jest.fn(async () => {
        user.passwordHash = passwordHashState;
        user.sessionEpoch = sessionEpoch;
        return user;
      }),
      casSessionEpoch: jest.fn(async () => 1),
      updatePasswordAndBumpEpoch: jest.fn(async (_id: string, nextHash: string) => {
        passwordHashState = nextHash;
        sessionEpoch += 1;
        user.passwordHash = passwordHashState;
        user.sessionEpoch = sessionEpoch;
        return user;
      }),
    } as unknown as UserRepository;

    const authController = new AuthController(
      new AuthService(userRepository, async () => undefined, refreshRepo, resetRepo, prisma),
      new EmailVerificationService(userRepository, stubEmailTokens(), { send: jest.fn(async () => undefined) }, prisma),
      new PasswordResetService(userRepository, resetRepo, refreshRepo, { send: jest.fn(async () => undefined) }, prisma),
    );
    const app = createApp({
      healthController: mockHealth(),
      authController,
      organizationController: dummyOrganizationController(),
      requireAccessToken: createRequireAccessToken(userRepository),
    });

    const res = await request(app)
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${access}`)
      .set('Cookie', 'refresh_token=keep-me')
      .send({ currentPassword: 'wrongpass99', newPassword: NEXT })
      .expect(401);

    expect(res.body.error.code).toBe('AUTH_UNAUTHORIZED');
    expect(res.body.error.message).toBe(AUTH_SESSION_UNAUTHORIZED_MESSAGE);
    expect(cookieHeader(res, 'refresh_token')).toBeUndefined();
    expect(sessionEpoch).toBe(0);
    expect(await verifyPassword(CURRENT, passwordHashState)).toBe(true);
    expect(refreshRevokedAt).toBeNull();
  });

  it('rejects newPassword equal to currentPassword with VALIDATION_ERROR', async () => {
    const harness = await buildHarness({ passwordHash });
    const live = seedRefresh(harness.refreshStore, hashToken('still-live'));
    const access = await signAccessToken({ sub: 'user_1', email: 'ada@example.com', systemRole: 'USER' });

    const res = await request(harness.app)
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${access}`)
      .send({ currentPassword: CURRENT, newPassword: CURRENT })
      .expect(400);

    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.newPassword).toBeDefined();
    expect(harness.user.sessionEpoch).toBe(0);
    expect(live.revokedAt).toBeNull();
    expect(cookieHeader(res, 'refresh_token')).toBeUndefined();
  });

  it('requires Bearer; cookie alone is insufficient and does not clear the cookie', async () => {
    const harness = await buildHarness({ passwordHash });
    seedRefresh(harness.refreshStore, hashToken('cookie-only'));

    const res = await request(harness.app)
      .post('/api/v1/auth/change-password')
      .set('Cookie', 'refresh_token=cookie-only')
      .send({ currentPassword: CURRENT, newPassword: NEXT })
      .expect(401);

    expect(res.body.error.code).toBe('AUTH_UNAUTHORIZED');
    expect(res.body.error.message).toBe(AUTH_SESSION_UNAUTHORIZED_MESSAGE);
    expect(cookieHeader(res, 'refresh_token')).toBeUndefined();
    expect(harness.user.sessionEpoch).toBe(0);
  });

  it('returns 401 for missing/malformed Authorization before body validation', async () => {
    const harness = await buildHarness({ passwordHash });
    for (const header of [undefined, 'Basic abc', 'Bearer', 'Bearer ']) {
      const pending = request(harness.app).post('/api/v1/auth/change-password').send({});
      if (header) {
        pending.set('Authorization', header);
      }
      const res = await pending.expect(401);
      expect(res.body.error.code).toBe('AUTH_UNAUTHORIZED');
    }
  });

  it('rejects inactive and unverified users', async () => {
    const access = await signAccessToken({ sub: 'user_1', email: 'ada@example.com', systemRole: 'USER' });

    const inactive = await buildHarness({ passwordHash, isActive: false });
    await request(inactive.app)
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${access}`)
      .send({ currentPassword: CURRENT, newPassword: NEXT })
      .expect(401);

    const unverified = await buildHarness({ passwordHash, emailVerifiedAt: null });
    await request(unverified.app)
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${access}`)
      .send({ currentPassword: CURRENT, newPassword: NEXT })
      .expect(401);
  });

  it('returns VALIDATION_ERROR for short passwords', async () => {
    const harness = await buildHarness({ passwordHash });
    const access = await signAccessToken({ sub: 'user_1', email: 'ada@example.com', systemRole: 'USER' });

    const res = await request(harness.app)
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${access}`)
      .send({ currentPassword: CURRENT, newPassword: 'short' })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(harness.user.sessionEpoch).toBe(0);
  });

  it('allows only one winner among concurrent change-password requests', async () => {
    const prisma = serialPrisma();
    const harness = await buildHarness({ passwordHash }, prisma);
    const access = await signAccessToken({ sub: 'user_1', email: 'ada@example.com', systemRole: 'USER' });

    const [first, second] = await Promise.all([
      request(harness.app)
        .post('/api/v1/auth/change-password')
        .set('Authorization', `Bearer ${access}`)
        .send({ currentPassword: CURRENT, newPassword: NEXT }),
      request(harness.app)
        .post('/api/v1/auth/change-password')
        .set('Authorization', `Bearer ${access}`)
        .send({ currentPassword: CURRENT, newPassword: 'otherpass99' }),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 401]);
    expect(harness.user.sessionEpoch).toBe(1);
    expect(await verifyPassword(CURRENT, harness.user.passwordHash)).toBe(false);
  });

  it('change-password vs reset: only one password write wins', async () => {
    const prisma = serialPrisma();
    const harness = await buildHarness({ passwordHash }, prisma);
    const resetRaw = generateToken();
    harness.resetStore.set(hashToken(resetRaw), {
      id: 'prt_race',
      userId: 'user_1',
      tokenHash: hashToken(resetRaw),
      expiresAt: future,
      usedAt: null,
      createdAt: now,
    });
    const access = await signAccessToken({ sub: 'user_1', email: 'ada@example.com', systemRole: 'USER' });

    const [change, reset] = await Promise.all([
      request(harness.app)
        .post('/api/v1/auth/change-password')
        .set('Authorization', `Bearer ${access}`)
        .send({ currentPassword: CURRENT, newPassword: NEXT }),
      request(harness.app)
        .post('/api/v1/auth/reset-password')
        .send({ token: resetRaw, password: 'resetwins1' }),
    ]);

    const okCount = [change.status, reset.status].filter((s) => s === 200).length;
    expect(okCount).toBe(1);
    expect(harness.user.sessionEpoch).toBe(1);
    expect(await verifyPassword(CURRENT, harness.user.passwordHash)).toBe(false);
  });

  it('revokes pre-change refresh rows while keeping the reissued session live after concurrent refresh', async () => {
    const prisma = serialPrisma();
    const harness = await buildHarness({ passwordHash }, prisma);
    const oldRaw = 'c'.repeat(64);
    seedRefresh(harness.refreshStore, hashToken(oldRaw));
    const access = await signAccessToken({ sub: 'user_1', email: 'ada@example.com', systemRole: 'USER' });

    const [change, refresh] = await Promise.all([
      request(harness.app)
        .post('/api/v1/auth/change-password')
        .set('Authorization', `Bearer ${access}`)
        .send({ currentPassword: CURRENT, newPassword: NEXT }),
      request(harness.app).post('/api/v1/auth/refresh').set('Cookie', `refresh_token=${oldRaw}`),
    ]);

    expect(change.status).toBe(200);
    const newRaw = cookieValue(cookieHeader(change, 'refresh_token')!);
    const reissued = harness.refreshStore.get(hashToken(newRaw));
    expect(reissued?.revokedAt).toBeNull();

    const old = harness.refreshStore.get(hashToken(oldRaw));
    expect(old?.revokedAt).not.toBeNull();

    if (refresh.status === 200) {
      const rotatedRaw = cookieValue(cookieHeader(refresh, 'refresh_token')!);
      const rotated = harness.refreshStore.get(hashToken(rotatedRaw));
      // If refresh won the race before revoke, change's revokeAll should still kill it.
      expect(rotated?.revokedAt).not.toBeNull();
    }

    await request(harness.app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', `refresh_token=${newRaw}`)
      .expect(200);
  });

  it('keeps the old access JWT usable until expiry (AF-4 residual)', async () => {
    const harness = await buildHarness({ passwordHash });
    const access = await signAccessToken({ sub: 'user_1', email: 'ada@example.com', systemRole: 'USER' });

    await request(harness.app)
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${access}`)
      .send({ currentPassword: CURRENT, newPassword: NEXT })
      .expect(200);

    await request(harness.app).get('/api/v1/auth/me').set('Authorization', `Bearer ${access}`).expect(200);
  });

  it('rejects excess change-password requests when a limiter is injected', async () => {
    const limiter: RequestHandler = (_req, _res, next) => {
      next(new AppError('RATE_LIMITED', 'Too many requests. Try again later.', 429));
    };
    const harness = await buildHarness({ passwordHash }, fakePrisma(), limiter);
    const access = await signAccessToken({ sub: 'user_1', email: 'ada@example.com', systemRole: 'USER' });

    const res = await request(harness.app)
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${access}`)
      .send({ currentPassword: CURRENT, newPassword: NEXT })
      .expect(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
  });

  it('does not change another user when Bearer belongs to a different account', async () => {
    const passwordHashA = await hashPassword(CURRENT);
    const passwordHashB = await hashPassword(CURRENT);
    const userA = storedUser({ id: 'user_1', email: 'ada@example.com', passwordHash: passwordHashA });
    const userB = storedUser({ id: 'user_2', email: 'other@example.com', passwordHash: passwordHashB });
    const refreshStore: RefreshStore = new Map();
    const resetRepo = memoryResetRepo(new Map());
    const refreshRepo = memoryRefreshRepo(refreshStore);
    const prisma = fakePrisma();
    const users = new Map([
      ['user_1', userA],
      ['user_2', userB],
    ]);
    const userRepository = {
      findByEmail: jest.fn(async () => null),
      findById: jest.fn(async (id: string) => users.get(id) ?? null),
      casSessionEpoch: jest.fn(async () => 1),
      updatePasswordAndBumpEpoch: jest.fn(async (id: string, nextHash: string) => {
        const target = users.get(id);
        if (!target) {
          throw new Error('missing user');
        }
        target.passwordHash = nextHash;
        target.sessionEpoch += 1;
        return target;
      }),
    } as unknown as UserRepository;

    const authController = new AuthController(
      new AuthService(userRepository, async () => undefined, refreshRepo, resetRepo, prisma),
      new EmailVerificationService(userRepository, stubEmailTokens(), { send: jest.fn(async () => undefined) }, prisma),
      new PasswordResetService(userRepository, resetRepo, refreshRepo, { send: jest.fn(async () => undefined) }, prisma),
    );
    const app = createApp({
      healthController: mockHealth(),
      authController,
      organizationController: dummyOrganizationController(),
      requireAccessToken: createRequireAccessToken(userRepository),
    });

    const access = await signAccessToken({ sub: 'user_2', email: 'other@example.com', systemRole: 'USER' });

    await request(app)
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${access}`)
      .send({ currentPassword: CURRENT, newPassword: NEXT })
      .expect(200);

    expect(await verifyPassword(CURRENT, userA.passwordHash)).toBe(true);
    expect(userA.sessionEpoch).toBe(0);
    expect(await verifyPassword(NEXT, userB.passwordHash)).toBe(true);
    expect(userB.sessionEpoch).toBe(1);
  });
});
