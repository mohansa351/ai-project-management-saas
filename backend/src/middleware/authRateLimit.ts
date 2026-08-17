import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../lib/http/appError.js';
import { logger } from '../lib/logger.js';

export const AUTH_RATE_LIMIT_WINDOW_SECONDS = 60;
export const AUTH_RATE_LIMIT_MAX = 10;
const CONNECT_TIMEOUT_MS = 500;

export type RedisRateLimitClient = {
  isOpen: boolean;
  connect: () => Promise<unknown>;
  incr: (key: string) => Promise<number>;
  ttl: (key: string) => Promise<number>;
  expire: (key: string, seconds: number) => Promise<unknown>;
};

async function ensureConnected(redis: RedisRateLimitClient): Promise<void> {
  if (redis.isOpen) {
    return;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      redis.connect(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('redis connect timeout')), CONNECT_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

export function createAuthRateLimit(redis: RedisRateLimitClient) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      await ensureConnected(redis);
      const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
      const key = `rl:auth:${ip}`;
      const count = await redis.incr(key);
      const ttl = await redis.ttl(key);
      if (ttl < 0) {
        await redis.expire(key, AUTH_RATE_LIMIT_WINDOW_SECONDS);
      }
      if (count > AUTH_RATE_LIMIT_MAX) {
        next(new AppError('RATE_LIMITED', 'Too many requests. Try again later.', 429));
        return;
      }
      next();
    } catch (err) {
      logger.warn({ err }, 'auth rate limit redis unavailable; failing open');
      next();
    }
  };
}
