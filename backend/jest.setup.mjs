import process from 'node:process';

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.PORT = process.env.PORT || '4000';
process.env.DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://apm:apm@127.0.0.1:5432/apm';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
process.env.CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:3000';
