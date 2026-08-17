import type { CookieOptions } from 'express';
import { env } from '../../config/env.js';

export const REFRESH_COOKIE_NAME = 'refresh_token';

export function refreshCookieOptions(secure = env.COOKIE_SECURE): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    path: '/api/v1',
    secure,
    maxAge: env.REFRESH_TOKEN_TTL_SECONDS * 1000,
  };
}

export function clearRefreshCookieOptions(secure = env.COOKIE_SECURE): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    path: '/api/v1',
    secure,
    expires: new Date(0),
  };
}
