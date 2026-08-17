import pino, { type DestinationStream, type Logger } from 'pino';
import { env } from '../config/env.js';

export const LOGGER_REDACT_PATHS = [
  'password',
  'passwordHash',
  'currentPassword',
  'newPassword',
  '*.password',
  '*.passwordHash',
  '*.currentPassword',
  '*.newPassword',
  'accessToken',
  'refreshToken',
  'refresh_token',
  'authorization',
  'cookie',
  'Cookie',
  'set-cookie',
  'headers.cookie',
  'req.headers.cookie',
  'JWT_ACCESS_SECRET',
  '*.accessToken',
  '*.refreshToken',
  '*.refresh_token',
  '*.authorization',
  '*.cookie',
  '*.JWT_ACCESS_SECRET',
];

export function createLogger(options?: {
  level?: string;
  destination?: DestinationStream;
}): Logger {
  return pino(
    {
      level: options?.level ?? (env.NODE_ENV === 'test' ? 'silent' : 'info'),
      redact: LOGGER_REDACT_PATHS,
    },
    options?.destination,
  );
}

export const logger = createLogger();
