import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../lib/http/appError.js';
import { logger } from '../lib/logger.js';

const WINDOW_SECONDS = 60;
const MAX_REQUESTS = 10;

export type RedisRateLimitClient = {
  isOpen: boolean;
  connect: () => Promise<unknown>;
  incr: (key: string) => Promise<number>;
  expire: (key: string, seconds: number) => Promise<unknown>;
};

export function createAuthRateLimit(redis: RedisRateLimitClient) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!redis.isOpen) {
        await redis.connect();
      }
      const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
      const key = `rl:auth:${ip}`;
      const count = await redis.incr(key);
      await redis.expire(key, WINDOW_SECONDS);
      if (count > MAX_REQUESTS) {
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
