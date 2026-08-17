import { describe, expect, it } from '@jest/globals';
import { loadEnv } from './env.js';

const requiredVars = {
  NODE_ENV: 'test',
  PORT: '4000',
  DATABASE_URL: 'postgresql://apm:apm@localhost:5432/apm',
  REDIS_URL: 'redis://127.0.0.1:6379',
  CORS_ORIGIN: 'http://localhost:3000',
  JWT_ACCESS_SECRET: 'test-jwt-access-secret',
} as const;

describe('EMAIL_VERIFICATION_TOKEN_TTL_MINUTES bounds', () => {
  it('defaults to 1440 when unset', () => {
    const env = loadEnv({ ...requiredVars });
    expect(env.EMAIL_VERIFICATION_TOKEN_TTL_MINUTES).toBe(1440);
  });

  it('accepts a valid in-range value', () => {
    const env = loadEnv({ ...requiredVars, EMAIL_VERIFICATION_TOKEN_TTL_MINUTES: '1440' });
    expect(env.EMAIL_VERIFICATION_TOKEN_TTL_MINUTES).toBe(1440);
  });

  it('accepts the upper bound (129600 minutes / ~90 days)', () => {
    const env = loadEnv({ ...requiredVars, EMAIL_VERIFICATION_TOKEN_TTL_MINUTES: '129600' });
    expect(env.EMAIL_VERIFICATION_TOKEN_TTL_MINUTES).toBe(129600);
  });

  it('rejects a value above the upper bound', () => {
    expect(() =>
      loadEnv({ ...requiredVars, EMAIL_VERIFICATION_TOKEN_TTL_MINUTES: '999999' }),
    ).toThrow(/Invalid environment/);
  });

  it('rejects zero and negative values', () => {
    expect(() =>
      loadEnv({ ...requiredVars, EMAIL_VERIFICATION_TOKEN_TTL_MINUTES: '0' }),
    ).toThrow(/Invalid environment/);
    expect(() =>
      loadEnv({ ...requiredVars, EMAIL_VERIFICATION_TOKEN_TTL_MINUTES: '-10' }),
    ).toThrow(/Invalid environment/);
  });

  it('rejects a non-integer value', () => {
    expect(() =>
      loadEnv({ ...requiredVars, EMAIL_VERIFICATION_TOKEN_TTL_MINUTES: '10.5' }),
    ).toThrow(/Invalid environment/);
  });
});

describe('JWT and cookie session env', () => {
  it('requires JWT_ACCESS_SECRET', () => {
    expect(() =>
      loadEnv({
        NODE_ENV: 'test',
        PORT: '4000',
        DATABASE_URL: requiredVars.DATABASE_URL,
        REDIS_URL: requiredVars.REDIS_URL,
        CORS_ORIGIN: requiredVars.CORS_ORIGIN,
      }),
    ).toThrow(/Invalid environment/);
  });

  it('defaults access/refresh TTLs and COOKIE_SECURE', () => {
    const env = loadEnv({ ...requiredVars });
    expect(env.ACCESS_TOKEN_TTL_SECONDS).toBe(900);
    expect(env.REFRESH_TOKEN_TTL_SECONDS).toBe(604800);
    expect(env.COOKIE_SECURE).toBe(false);
    expect(env).not.toHaveProperty('JWT_REFRESH_SECRET');
  });

  it('parses COOKIE_SECURE=true without treating the string as always truthy', () => {
    expect(loadEnv({ ...requiredVars, COOKIE_SECURE: 'true' }).COOKIE_SECURE).toBe(true);
    expect(loadEnv({ ...requiredVars, COOKIE_SECURE: 'false' }).COOKIE_SECURE).toBe(false);
  });

  it('ignores JWT_REFRESH_SECRET even when present', () => {
    const env = loadEnv({ ...requiredVars, JWT_REFRESH_SECRET: 'should-not-load' });
    expect(env).not.toHaveProperty('JWT_REFRESH_SECRET');
  });

  it('rejects access TTL above 3600 seconds and refresh TTL that would overflow cookie Max-Age', () => {
    expect(() => loadEnv({ ...requiredVars, ACCESS_TOKEN_TTL_SECONDS: '3601' })).toThrow(/Invalid environment/);
    expect(() => loadEnv({ ...requiredVars, REFRESH_TOKEN_TTL_SECONDS: '2147484' })).toThrow(/Invalid environment/);
  });

  it('defaults COOKIE_SECURE true in production when unset and rejects weak production secrets', () => {
    const productionSecret = 'a'.repeat(32);
    const productionBase = {
      ...requiredVars,
      NODE_ENV: 'production',
      JWT_ACCESS_SECRET: productionSecret,
    };
    expect(loadEnv(productionBase).COOKIE_SECURE).toBe(true);
    expect(() => loadEnv({ ...productionBase, JWT_ACCESS_SECRET: 'change-me-access' })).toThrow(
      /JWT_ACCESS_SECRET/,
    );
    expect(() => loadEnv({ ...productionBase, JWT_ACCESS_SECRET: 'short-secret' })).toThrow(/JWT_ACCESS_SECRET/);
    expect(() => loadEnv({ ...productionBase, COOKIE_SECURE: 'false' })).toThrow(/COOKIE_SECURE/);
    expect(loadEnv({ ...productionBase, COOKIE_SECURE: 'true' }).COOKIE_SECURE).toBe(true);
  });
});
