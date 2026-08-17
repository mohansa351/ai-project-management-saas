import { describe, expect, it, jest } from '@jest/globals';
import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../lib/http/appError.js';
import {
  AUTH_RATE_LIMIT_WINDOW_SECONDS,
  createAuthRateLimit,
  type RedisRateLimitClient,
} from './authRateLimit.js';

function run(redis: RedisRateLimitClient, ip = '203.0.113.10') {
  const mw = createAuthRateLimit(redis);
  const req = { ip, socket: { remoteAddress: ip } } as unknown as Request;
  const res = {} as Response;
  const next = jest.fn() as unknown as NextFunction;
  return { mw, req, res, next };
}

function redisStub(overrides: Partial<RedisRateLimitClient> = {}): RedisRateLimitClient {
  return {
    isOpen: true,
    connect: jest.fn(async () => undefined),
    incr: jest.fn(async () => 1),
    ttl: jest.fn(async () => -1),
    expire: jest.fn(async () => 1),
    ...overrides,
  };
}

describe('createAuthRateLimit', () => {
  it('allows requests under the cap and sets expiry when the key has no TTL', async () => {
    const expire = jest.fn<RedisRateLimitClient['expire']>(async () => 1);
    const redis = redisStub({
      incr: jest.fn(async () => 1),
      ttl: jest.fn(async () => -1),
      expire,
    });
    const { mw, req, res, next } = run(redis);
    await mw(req, res, next);
    expect(redis.incr).toHaveBeenCalledWith('rl:auth:203.0.113.10');
    expect(expire).toHaveBeenCalledWith('rl:auth:203.0.113.10', AUTH_RATE_LIMIT_WINDOW_SECONDS);
    expect(next).toHaveBeenCalledWith();
  });

  it('does not reset a live window TTL on later increments', async () => {
    const expire = jest.fn<RedisRateLimitClient['expire']>(async () => 1);
    const redis = redisStub({
      incr: jest.fn(async () => 2),
      ttl: jest.fn(async () => 41),
      expire,
    });
    const { mw, req, res, next } = run(redis);
    await mw(req, res, next);
    expect(expire).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith();
  });

  it('repairs a key that was incremented without a TTL', async () => {
    const expire = jest.fn<RedisRateLimitClient['expire']>(async () => 1);
    const redis = redisStub({
      incr: jest.fn(async () => 3),
      ttl: jest.fn(async () => -1),
      expire,
    });
    const { mw, req, res, next } = run(redis);
    await mw(req, res, next);
    expect(expire).toHaveBeenCalledWith('rl:auth:203.0.113.10', AUTH_RATE_LIMIT_WINDOW_SECONDS);
  });

  it('returns RATE_LIMITED when the cap is exceeded', async () => {
    const redis = redisStub({
      incr: jest.fn(async () => 11),
      ttl: jest.fn(async () => 50),
    });
    const { mw, req, res, next } = run(redis);
    await mw(req, res, next);
    const err = (next as unknown as jest.Mock).mock.calls[0]?.[0] as AppError;
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe('RATE_LIMITED');
    expect(err.statusCode).toBe(429);
  });

  it('fails open when Redis throws or connect times out', async () => {
    const throwing = redisStub({
      incr: jest.fn(async () => {
        throw new Error('redis down');
      }),
    });
    const hung = redisStub({
      isOpen: false,
      connect: jest.fn(async () => new Promise(() => undefined)),
    });
    for (const redis of [throwing, hung]) {
      const { mw, req, res, next } = run(redis);
      await mw(req, res, next);
      expect(next).toHaveBeenCalledWith();
    }
  });
});
