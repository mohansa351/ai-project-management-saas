import { createClient } from 'redis';
import { env } from '../config/env.js';
import { logger } from './logger.js';

export const redis = createClient({ url: env.REDIS_URL });

redis.on('error', (err: unknown) => {
  logger.warn({ err }, 'redis client error');
});
