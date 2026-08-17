import { describe, expect, it } from '@jest/globals';
import { SignJWT, jwtVerify } from 'jose';
import { env } from '../config/env.js';
import { AppError } from './http/appError.js';
import { signAccessToken, verifyAccessToken } from './jwt.js';

describe('signAccessToken', () => {
  it('signs HS256 claims with the configured access TTL', async () => {
    const token = await signAccessToken({
      sub: 'user_1',
      email: 'ada@example.com',
      systemRole: 'USER',
    });
    const verified = await jwtVerify(token, new TextEncoder().encode(env.JWT_ACCESS_SECRET));
    expect(verified.protectedHeader.alg).toBe('HS256');
    expect(verified.payload.sub).toBe('user_1');
    expect(verified.payload.email).toBe('ada@example.com');
    expect(verified.payload.systemRole).toBe('USER');
    expect((verified.payload.exp ?? 0) - (verified.payload.iat ?? 0)).toBe(env.ACCESS_TOKEN_TTL_SECONDS);
  });
});

describe('verifyAccessToken', () => {
  it('returns claims for a valid HS256 token', async () => {
    const token = await signAccessToken({
      sub: 'user_1',
      email: 'ada@example.com',
      systemRole: 'USER',
    });
    await expect(verifyAccessToken(token)).resolves.toEqual({
      sub: 'user_1',
      email: 'ada@example.com',
      systemRole: 'USER',
    });
  });

  it('rejects an expired token', async () => {
    const token = await new SignJWT({ email: 'ada@example.com', systemRole: 'USER' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('user_1')
      .setIssuedAt()
      .setExpirationTime(0)
      .sign(new TextEncoder().encode(env.JWT_ACCESS_SECRET));
    await expect(verifyAccessToken(token)).rejects.toMatchObject({
      code: 'AUTH_UNAUTHORIZED',
      statusCode: 401,
    });
  });

  it('rejects a token with the wrong signature', async () => {
    const token = await new SignJWT({ email: 'ada@example.com', systemRole: 'USER' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('user_1')
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(new TextEncoder().encode('wrong-secret-wrong-secret-wrong-12'));
    await expect(verifyAccessToken(token)).rejects.toBeInstanceOf(AppError);
  });
});
