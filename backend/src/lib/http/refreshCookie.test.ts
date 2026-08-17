import { describe, expect, it } from '@jest/globals';
import { env } from '../../config/env.js';
import { clearRefreshCookieOptions, refreshCookieOptions } from './refreshCookie.js';

describe('refresh cookie options', () => {
  it('sets Max-Age from the refresh TTL and Secure from the flag', () => {
    const insecure = refreshCookieOptions(false);
    expect(insecure.httpOnly).toBe(true);
    expect(insecure.sameSite).toBe('lax');
    expect(insecure.path).toBe('/api/v1');
    expect(insecure.secure).toBe(false);
    expect(insecure.maxAge).toBe(env.REFRESH_TOKEN_TTL_SECONDS * 1000);

    const secure = refreshCookieOptions(true);
    expect(secure.secure).toBe(true);
    expect(clearRefreshCookieOptions(true).secure).toBe(true);
    expect(clearRefreshCookieOptions(true).expires).toEqual(new Date(0));
    expect(clearRefreshCookieOptions(true).maxAge).toBe(0);

    const fromEnv = refreshCookieOptions();
    expect(fromEnv.secure).toBe(env.COOKIE_SECURE);
    expect(clearRefreshCookieOptions().secure).toBe(env.COOKIE_SECURE);
    expect(clearRefreshCookieOptions().maxAge).toBe(0);
  });
});
