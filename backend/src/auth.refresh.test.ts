import { describe, expect, it, jest } from '@jest/globals';
import type { PrismaClient, RefreshToken, User } from '@prisma/client';
import { jwtVerify } from 'jose';
import request from 'supertest';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { AuthController } from './controllers/authController.js';
import { HealthController } from './controllers/healthController.js';
import { AUTH_SESSION_UNAUTHORIZED_MESSAGE } from './lib/http/authErrors.js';
import { hashToken } from './lib/token.js';
import type { EmailVerificationTokenRepository } from './repositories/emailVerificationTokenRepository.js';
import { RefreshTokenRepository } from './repositories/refreshTokenRepository.js';
import type { UserRepository } from './repositories/userRepository.js';
import { AuthService } from './services/authService.js';
import { EmailVerificationService } from './services/emailVerificationService.js';
import type { PasswordResetService } from './services/passwordResetService.js';
import type { HealthService } from './services/healthService.js';

const now = new Date('2026-08-14T00:00:00.000Z');
const future = new Date('2026-09-01T00:00:00.000Z');

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

function stubPasswordResetTokens() {
  return {
    create: jest.fn(),
    findValidByHash: jest.fn(async () => null),
    markUsedIfActive: jest.fn(async () => 0),
    invalidateUnusedForUser: jest.fn(async () => undefined),
    lockForUser: jest.fn(async () => undefined),
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

function isClearCookie(header: string | undefined): boolean {
  if (!header) {
    return false;
  }
  return /refresh_token=;/i.test(header) || /Expires=Thu, 01 Jan 1970/i.test(header);
}

type Store = Map<string, RefreshToken>;

function memoryRefreshRepo(store: Store): RefreshTokenRepository {
  const repo = {
    lockForRotation: jest.fn(async () => undefined),
    findByHash: jest.fn(async (tokenHash: string) => store.get(tokenHash) ?? null),
    create: jest.fn(async (input: {
      userId: string;
      tokenHash: string;
      expiresAt: Date;
      userAgent?: string;
      replacedByHash?: string | null;
    }) => {
      const row: RefreshToken = {
        id: `rt_${store.size + 1}`,
        userId: input.userId,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
        revokedAt: null,
        replacedByHash: input.replacedByHash ?? null,
        userAgent: input.userAgent ?? null,
        createdAt: new Date(),
      };
      store.set(input.tokenHash, row);
      return row;
    }),
    claimRotation: jest.fn(async (tokenHash: string, successorHash: string) => {
      const row = store.get(tokenHash);
      if (!row || row.revokedAt !== null || row.expiresAt <= new Date()) {
        return 0;
      }
      row.revokedAt = new Date();
      row.replacedByHash = successorHash;
      return 1;
    }),
    revokeByHash: jest.fn(async (tokenHash: string) => {
      const row = store.get(tokenHash);
      if (!row || row.revokedAt !== null || row.expiresAt <= new Date()) {
        return 0;
      }
      row.revokedAt = new Date();
      return 1;
    }),
    revokeLiveLeafOfChain: jest.fn(async (start: RefreshToken) => {
      let current: RefreshToken | undefined = start;
      let foundRotatedSuccessor = false;
      let liveLeafHash: string | null = null;
      while (current?.replacedByHash) {
        const next = store.get(current.replacedByHash);
        if (!next) {
          break;
        }
        if (next.replacedByHash) {
          foundRotatedSuccessor = true;
        }
        if (next.revokedAt === null && next.expiresAt > new Date()) {
          liveLeafHash = next.tokenHash;
        }
        current = next;
      }
      if (!foundRotatedSuccessor || !liveLeafHash) {
        return null;
      }
      const leaf = store.get(liveLeafHash);
      if (leaf && leaf.revokedAt === null) {
        leaf.revokedAt = new Date();
      }
      return liveLeafHash;
    }),
  };
  return repo as unknown as RefreshTokenRepository;
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

function seedRow(store: Store, overrides: Partial<RefreshToken> & Pick<RefreshToken, 'tokenHash'>): RefreshToken {
  const row: RefreshToken = {
    id: overrides.id ?? `rt_${overrides.tokenHash}`,
    userId: overrides.userId ?? 'user_1',
    tokenHash: overrides.tokenHash,
    expiresAt: overrides.expiresAt ?? future,
    revokedAt: overrides.revokedAt ?? null,
    replacedByHash: overrides.replacedByHash ?? null,
    userAgent: overrides.userAgent ?? null,
    createdAt: overrides.createdAt ?? now,
  };
  store.set(row.tokenHash, row);
  return row;
}

function refreshApp(user: User | null, store: Store, casCount = 1) {
  const prisma = serialPrisma();
  const refreshTokenRepository = memoryRefreshRepo(store);
  const casSessionEpoch = jest.fn<(id: string, expected: number, tx?: unknown) => Promise<number>>(
    async () => casCount,
  );
  const userRepository = {
    findByEmail: jest.fn(),
    findById: jest.fn(async () => user),
    casSessionEpoch,
  } as unknown as UserRepository;
  const authController = new AuthController(
    new AuthService(userRepository, async () => undefined, refreshTokenRepository, stubPasswordResetTokens() as never, prisma),
    new EmailVerificationService(userRepository, stubEmailTokens(), { send: jest.fn(async () => undefined) }, prisma),
    { forgot: async () => undefined, reset: async () => undefined } as unknown as PasswordResetService,
  );
  return {
    app: createApp({ healthController: mockHealth(), authController }),
    store,
    refreshTokenRepository,
    casSessionEpoch,
  };
}

describe('POST /api/v1/auth/refresh', () => {
  it('rotates a live cookie: new access JWT, hashed successor, Set-Cookie is not the presented token', async () => {
    const raw = 'a'.repeat(64);
    const store: Store = new Map();
    seedRow(store, { tokenHash: hashToken(raw) });
    const { app, store: after } = refreshApp(storedUser(), store);

    const res = await request(app).post('/api/v1/auth/refresh').set('Cookie', `refresh_token=${raw}`).expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.user).not.toHaveProperty('passwordHash');
    expect(res.body.data).not.toHaveProperty('refreshToken');
    const accessToken = res.body.data.accessToken as string;
    const verified = await jwtVerify(accessToken, new TextEncoder().encode(env.JWT_ACCESS_SECRET));
    expect(verified.payload.sub).toBe('user_1');
    expect((verified.payload.exp ?? 0) - (verified.payload.iat ?? 0)).toBe(env.ACCESS_TOKEN_TTL_SECONDS);

    const setCookie = cookieHeader(res, 'refresh_token');
    expect(setCookie).toBeDefined();
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).toMatch(/Path=\/api\/v1/i);
    const nextRaw = cookieValue(setCookie!);
    expect(nextRaw).not.toBe(raw);
    expect(nextRaw).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(res.body)).not.toContain(raw);
    expect(JSON.stringify(res.body)).not.toContain(nextRaw);

    const old = after.get(hashToken(raw));
    expect(old?.revokedAt).not.toBeNull();
    expect(old?.replacedByHash).toBe(hashToken(nextRaw));
    const successor = after.get(hashToken(nextRaw));
    expect(successor).toBeDefined();
    expect(successor?.revokedAt).toBeNull();
    expect(successor?.tokenHash).not.toBe(nextRaw);
  });

  it('ignores a body refreshToken when the cookie is missing', async () => {
    const raw = 'b'.repeat(64);
    const store: Store = new Map();
    seedRow(store, { tokenHash: hashToken(raw) });
    const { app, store: after } = refreshApp(storedUser(), store);

    const res = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: raw }).expect(401);

    expect(res.body.error.code).toBe('AUTH_UNAUTHORIZED');
    expect(res.body.error.message).toBe(AUTH_SESSION_UNAUTHORIZED_MESSAGE);
    expect(res.body.data).toBeUndefined();
    expect(after.get(hashToken(raw))?.revokedAt).toBeNull();
    expect(cookieHeader(res, 'refresh_token')).toBeUndefined();
  });

  it('uses the cookie, not a different body refreshToken', async () => {
    const cookieRaw = 'c'.repeat(64);
    const bodyRaw = 'd'.repeat(64);
    const store: Store = new Map();
    seedRow(store, { tokenHash: hashToken(cookieRaw) });
    seedRow(store, { tokenHash: hashToken(bodyRaw), id: 'body' });
    const { app, store: after } = refreshApp(storedUser(), store);

    await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', `refresh_token=${cookieRaw}`)
      .send({ refreshToken: bodyRaw })
      .expect(200);

    expect(after.get(hashToken(cookieRaw))?.revokedAt).not.toBeNull();
    expect(after.get(hashToken(bodyRaw))?.revokedAt).toBeNull();
  });

  it('returns 401 and clears the cookie for unknown, expired, and logout-revoked tokens', async () => {
    const user = storedUser();

    const unknownStore: Store = new Map();
    const unknown = await request(refreshApp(user, unknownStore).app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', 'refresh_token=unknown-token')
      .expect(401);
    expect(isClearCookie(cookieHeader(unknown, 'refresh_token'))).toBe(true);
    expect(unknown.body.data).toBeUndefined();

    const expiredRaw = 'e'.repeat(64);
    const expiredStore: Store = new Map();
    seedRow(expiredStore, { tokenHash: hashToken(expiredRaw), expiresAt: new Date('2020-01-01T00:00:00.000Z') });
    const expired = await request(refreshApp(user, expiredStore).app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', `refresh_token=${expiredRaw}`)
      .expect(401);
    expect(isClearCookie(cookieHeader(expired, 'refresh_token'))).toBe(true);
    expect(expiredStore.get(hashToken(expiredRaw))?.replacedByHash).toBeNull();

    const logoutRaw = 'f'.repeat(64);
    const logoutStore: Store = new Map();
    seedRow(logoutStore, {
      tokenHash: hashToken(logoutRaw),
      revokedAt: new Date('2026-08-16T00:00:00.000Z'),
      replacedByHash: null,
    });
    const logout = await request(refreshApp(user, logoutStore).app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', `refresh_token=${logoutRaw}`)
      .expect(401);
    expect(isClearCookie(cookieHeader(logout, 'refresh_token'))).toBe(true);
  });

  it('rejects inactive and unverified users, revoking this row only', async () => {
    const independentHash = hashToken('independent-session');
    for (const user of [storedUser({ isActive: false }), storedUser({ emailVerifiedAt: null })]) {
      const raw = 'g'.repeat(64);
      const store: Store = new Map();
      seedRow(store, { tokenHash: hashToken(raw) });
      seedRow(store, { tokenHash: independentHash, id: 'other' });
      const res = await request(refreshApp(user, store).app)
        .post('/api/v1/auth/refresh')
        .set('Cookie', `refresh_token=${raw}`)
        .expect(401);
      expect(res.body.data).toBeUndefined();
      expect(isClearCookie(cookieHeader(res, 'refresh_token'))).toBe(true);
      expect(store.get(hashToken(raw))?.revokedAt).not.toBeNull();
      expect(store.get(independentHash)?.revokedAt).toBeNull();
    }
  });

  it('treats a missing successor as 401 with clear, not theft', async () => {
    const raw = 'h'.repeat(64);
    const store: Store = new Map();
    const independentHash = hashToken('still-live');
    seedRow(store, {
      tokenHash: hashToken(raw),
      revokedAt: new Date('2026-08-16T00:00:00.000Z'),
      replacedByHash: 'missing-successor-hash',
    });
    seedRow(store, { tokenHash: independentHash, id: 'ind' });
    const res = await request(refreshApp(storedUser(), store).app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', `refresh_token=${raw}`)
      .expect(401);
    expect(isClearCookie(cookieHeader(res, 'refresh_token'))).toBe(true);
    expect(store.get(independentHash)?.revokedAt).toBeNull();
  });

  it('allows only one winner among two concurrent refreshes with the same cookie', async () => {
    const raw = 'i'.repeat(64);
    const independentHash = hashToken('device-b');
    const store: Store = new Map();
    seedRow(store, { tokenHash: hashToken(raw) });
    seedRow(store, { tokenHash: independentHash, id: 'device-b' });
    const { app } = refreshApp(storedUser(), store);

    const [first, second] = await Promise.all([
      request(app).post('/api/v1/auth/refresh').set('Cookie', `refresh_token=${raw}`),
      request(app).post('/api/v1/auth/refresh').set('Cookie', `refresh_token=${raw}`),
    ]);

    const responses = [first, second];
    const winners = responses.filter((r) => r.status === 200);
    const losers = responses.filter((r) => r.status === 401);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(winners[0]?.body.data.accessToken).toEqual(expect.any(String));
    expect(losers[0]?.body.data).toBeUndefined();
    expect(cookieHeader(winners[0]!, 'refresh_token')).toBeDefined();
    expect(isClearCookie(cookieHeader(winners[0]!, 'refresh_token'))).toBe(false);
    expect(cookieHeader(losers[0]!, 'refresh_token')).toBeUndefined();
    expect(store.get(independentHash)?.revokedAt).toBeNull();
    const successors = [...store.values()].filter((row) => row.replacedByHash === null && row.revokedAt === null);
    expect(successors.filter((row) => row.tokenHash !== independentHash)).toHaveLength(1);
  });

  it('allows only one winner among five concurrent refreshes and keeps an independent session', async () => {
    const raw = 'j'.repeat(64);
    const independentHash = hashToken('phone');
    const store: Store = new Map();
    seedRow(store, { tokenHash: hashToken(raw) });
    seedRow(store, { tokenHash: independentHash, id: 'phone' });
    const { app } = refreshApp(storedUser(), store);

    const responses = await Promise.all(
      Array.from({ length: 5 }, () => request(app).post('/api/v1/auth/refresh').set('Cookie', `refresh_token=${raw}`)),
    );

    expect(responses.filter((r) => r.status === 200)).toHaveLength(1);
    expect(responses.filter((r) => r.status === 401)).toHaveLength(4);
    for (const loser of responses.filter((r) => r.status === 401)) {
      expect(loser.body.data).toBeUndefined();
      expect(cookieHeader(loser, 'refresh_token')).toBeUndefined();
    }
    expect(store.get(independentHash)?.revokedAt).toBeNull();
  });

  it('treats stale T1 as overlap while T2 is live: 401, no cookie mutation, T2 stays live', async () => {
    const t1Raw = 'k'.repeat(64);
    const t2Hash = hashToken('t2-raw-not-needed');
    const store: Store = new Map();
    seedRow(store, {
      tokenHash: hashToken(t1Raw),
      revokedAt: new Date('2026-08-16T00:00:00.000Z'),
      replacedByHash: t2Hash,
    });
    seedRow(store, { tokenHash: t2Hash, id: 't2' });
    const res = await request(refreshApp(storedUser(), store).app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', `refresh_token=${t1Raw}`)
      .expect(401);
    expect(res.body.data).toBeUndefined();
    expect(cookieHeader(res, 'refresh_token')).toBeUndefined();
    expect(store.get(t2Hash)?.revokedAt).toBeNull();
  });

  it('revokes only the live leaf on T1 replay after T1→T2→T3', async () => {
    const t1Raw = 'm'.repeat(64);
    const t2Hash = 'hash-t2';
    const t3Hash = 'hash-t3';
    const independentHash = hashToken('laptop');
    const store: Store = new Map();
    seedRow(store, {
      tokenHash: hashToken(t1Raw),
      revokedAt: new Date('2026-08-16T00:00:00.000Z'),
      replacedByHash: t2Hash,
    });
    seedRow(store, {
      tokenHash: t2Hash,
      id: 't2',
      revokedAt: new Date('2026-08-16T01:00:00.000Z'),
      replacedByHash: t3Hash,
    });
    seedRow(store, { tokenHash: t3Hash, id: 't3' });
    seedRow(store, { tokenHash: independentHash, id: 'laptop' });

    const res = await request(refreshApp(storedUser(), store).app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', `refresh_token=${t1Raw}`)
      .expect(401);

    expect(isClearCookie(cookieHeader(res, 'refresh_token'))).toBe(true);
    expect(res.body.data).toBeUndefined();
    expect(store.get(t3Hash)?.revokedAt).not.toBeNull();
    expect(store.get(independentHash)?.revokedAt).toBeNull();
  });

  it('does not treat logout of T2 as theft when stale T1 is presented', async () => {
    const t1Raw = 'n'.repeat(64);
    const t2Hash = 'hash-t2-logout';
    const independentHash = hashToken('other-device');
    const store: Store = new Map();
    seedRow(store, {
      tokenHash: hashToken(t1Raw),
      revokedAt: new Date('2026-08-16T00:00:00.000Z'),
      replacedByHash: t2Hash,
    });
    seedRow(store, {
      tokenHash: t2Hash,
      id: 't2',
      revokedAt: new Date('2026-08-16T02:00:00.000Z'),
      replacedByHash: null,
    });
    seedRow(store, { tokenHash: independentHash, id: 'other' });

    const res = await request(refreshApp(storedUser(), store).app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', `refresh_token=${t1Raw}`)
      .expect(401);

    expect(isClearCookie(cookieHeader(res, 'refresh_token'))).toBe(true);
    expect(store.get(independentHash)?.revokedAt).toBeNull();
  });

  it('skips successor create when sessionEpoch CAS loses to a concurrent reset', async () => {
    const raw = 'p'.repeat(64);
    const store: Store = new Map();
    seedRow(store, { tokenHash: hashToken(raw) });
    const { app, store: after, casSessionEpoch } = refreshApp(storedUser({ sessionEpoch: 0 }), store, 0);

    const res = await request(app).post('/api/v1/auth/refresh').set('Cookie', `refresh_token=${raw}`).expect(401);

    expect(casSessionEpoch).toHaveBeenCalledWith('user_1', 0, expect.anything());

    expect(res.body.data).toBeUndefined();
    expect(after.get(hashToken(raw))?.revokedAt).not.toBeNull();
    const liveSuccessors = [...after.values()].filter(
      (row) => row.revokedAt === null && row.replacedByHash === null && row.tokenHash !== hashToken(raw),
    );
    expect(liveSuccessors).toHaveLength(0);
  });
});
