import { describe, expect, it, jest } from '@jest/globals';
import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../lib/http/appError.js';
import { createAuthRateLimit, type RedisRateLimitClient } from './authRateLimit.js';

function run(redis: RedisRateLimitClient) {
  const mw = createAuthRateLimit(redis);
  const req = { ip: '203.0.113.10', socket: { remoteAddress: '203.0.113.10' } } as unknown as Request;
  const res = {} as Response;
  const next = jest.fn() as unknown as NextFunction;
  return { mw, req, res, next };
}

describe('createAuthRateLimit', () => {
  it('allows requests under the cap and sets expiry on first increment', async () => {
    const incr = jest.fn<RedisRateLimitClient['incr']>(async () => 1);
    const expire = jest.fn<RedisRateLimitClient['expire']>(async () => 1);
    const redis: RedisRateLimitClient = {
      isOpen: true,
      connect: jest.fn(async () => undefined),
      incr,
      expire,
    };
    const { mw, req, res, next } = run(redis);
    await mw(req, res, next);
    expect(incr).toHaveBeenCalledWith('rl:auth:203.0.113.10');
    expect(expire).toHaveBeenCalledWith('rl:auth:203.0.113.10', 60);
    expect(next).toHaveBeenCalledWith();
  });

  it('still sets the window TTL after the first increment', async () => {
    const expire = jest.fn<RedisRateLimitClient['expire']>(async () => 1);
    const redis: RedisRateLimitClient = {
      isOpen: true,
      connect: jest.fn(async () => undefined),
      incr: jest.fn(async () => 2),
      expire,
    };
    const { mw, req, res, next } = run(redis);
    await mw(req, res, next);
    expect(expire).toHaveBeenCalledWith('rl:auth:203.0.113.10', 60);
    expect(next).toHaveBeenCalledWith();
  });

  it('returns RATE_LIMITED when the cap is exceeded', async () => {
    const redis: RedisRateLimitClient = {
      isOpen: true,
      connect: jest.fn(async () => undefined),
      incr: jest.fn(async () => 11),
      expire: jest.fn(async () => 1),
    };
    const { mw, req, res, next } = run(redis);
    await mw(req, res, next);
    const err = (next as unknown as jest.Mock).mock.calls[0]?.[0] as AppError;
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe('RATE_LIMITED');
    expect(err.statusCode).toBe(429);
  });

  it('fails open and warns when Redis throws', async () => {
    const redis: RedisRateLimitClient = {
      isOpen: true,
      connect: jest.fn(async () => undefined),
      incr: jest.fn(async () => {
        throw new Error('redis down');
      }),
      expire: jest.fn(async () => 1),
    };
    const { mw, req, res, next } = run(redis);
    await mw(req, res, next);
    expect(next).toHaveBeenCalledWith();
  });
});
