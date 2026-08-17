import { describe, expect, it, jest } from '@jest/globals';
import type { NextFunction, Request, Response } from 'express';
import type { User } from '@prisma/client';
import { signAccessToken } from '../lib/jwt.js';
import type { UserRepository } from '../repositories/userRepository.js';
import { createRequireAccessToken } from './requireAccessToken.js';

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

async function run(
  header: string | undefined,
  user: User | null,
): Promise<{ err: unknown; req: Request }> {
  const req = { get: (name: string) => (name.toLowerCase() === 'authorization' ? header : undefined) } as Request;
  const userRepository = { findById: jest.fn(async () => user) } as unknown as UserRepository;
  const mw = createRequireAccessToken(userRepository);
  let err: unknown;
  await mw(req, {} as Response, ((e?: unknown) => {
    err = e;
  }) as NextFunction);
  return { err, req };
}

describe('createRequireAccessToken', () => {
  it('attaches the public user for Bearer and bearer schemes', async () => {
    const token = await signAccessToken({
      sub: 'user_1',
      email: 'ada@example.com',
      systemRole: 'USER',
    });
    const user = storedUser();
    const upper = await run(`Bearer ${token}`, user);
    expect(upper.err).toBeUndefined();
    expect(upper.req.user?.id).toBe('user_1');
    expect(upper.req.user).not.toHaveProperty('passwordHash');

    const lower = await run(`bearer ${token}`, user);
    expect(lower.err).toBeUndefined();
    expect(lower.req.user?.email).toBe('ada@example.com');
  });

  it('rejects missing, malformed, and empty Bearer tokens', async () => {
    const user = storedUser();
    for (const header of [undefined, 'Basic abc', 'Bearer', 'Bearer ', 'Bearer  ']) {
      const { err } = await run(header, user);
      expect(err).toMatchObject({ code: 'AUTH_UNAUTHORIZED', statusCode: 401 });
    }
  });

  it('rejects inactive and unverified users', async () => {
    const token = await signAccessToken({
      sub: 'user_1',
      email: 'ada@example.com',
      systemRole: 'USER',
    });
    const inactive = await run(`Bearer ${token}`, storedUser({ isActive: false }));
    const unverified = await run(`Bearer ${token}`, storedUser({ emailVerifiedAt: null }));
    const missing = await run(`Bearer ${token}`, null);
    for (const result of [inactive, unverified, missing]) {
      expect(result.err).toMatchObject({ code: 'AUTH_UNAUTHORIZED', statusCode: 401 });
      expect(result.req.user).toBeUndefined();
    }
  });
});
