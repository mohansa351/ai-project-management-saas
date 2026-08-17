import { describe, expect, it } from '@jest/globals';
import { jwtVerify } from 'jose';
import { env } from '../config/env.js';
import { signAccessToken } from './jwt.js';

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
