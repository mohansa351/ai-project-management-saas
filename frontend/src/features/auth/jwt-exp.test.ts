import { describe, expect, it } from 'vitest';

import { accessTokenLooksUnexpired } from '@/features/auth/jwt-exp';

function unsignedJwt(exp: number): string {
  const payload = Buffer.from(JSON.stringify({ exp, sub: 'user_1' })).toString(
    'base64url',
  );
  return `eyJhbGciOiJub25lIn0.${payload}.sig`;
}

describe('accessTokenLooksUnexpired', () => {
  it('returns false for missing or malformed tokens', () => {
    expect(accessTokenLooksUnexpired(null)).toBe(false);
    expect(accessTokenLooksUnexpired('nope')).toBe(false);
  });

  it('treats future exp as unexpired and past exp as expired', () => {
    const now = 1_700_000_000;
    expect(accessTokenLooksUnexpired(unsignedJwt(now + 60), now)).toBe(true);
    expect(accessTokenLooksUnexpired(unsignedJwt(now - 1), now)).toBe(false);
  });
});
