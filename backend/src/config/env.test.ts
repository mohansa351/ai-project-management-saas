import { describe, expect, it } from '@jest/globals';
import { loadEnv } from './env.js';

const requiredVars = {
  NODE_ENV: 'test',
  PORT: '4000',
  DATABASE_URL: 'postgresql://apm:apm@localhost:5432/apm',
  REDIS_URL: 'redis://127.0.0.1:6379',
  CORS_ORIGIN: 'http://localhost:3000',
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
