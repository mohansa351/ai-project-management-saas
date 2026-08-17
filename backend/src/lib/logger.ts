import pino from 'pino';
import { env } from '../config/env.js';

export const logger = pino({
  level: env.NODE_ENV === 'test' ? 'silent' : 'info',
  redact: [
    'password',
    'passwordHash',
    '*.password',
    '*.passwordHash',
    'accessToken',
    'refreshToken',
    'refresh_token',
    'authorization',
    '*.accessToken',
    '*.refreshToken',
    '*.refresh_token',
  ],
});
