import { describe, expect, it, jest } from '@jest/globals';
import { HealthRepository } from './healthRepository.js';
import type { PrismaClient } from '@prisma/client';

describe('HealthRepository', () => {
  it('pings postgres via queryRaw and redis via ping', async () => {
    const prisma = {
      $queryRaw: jest.fn(async () => [{ '?column?': 1 }]),
    } as unknown as PrismaClient;
    const redis = {
      isOpen: true,
      connect: jest.fn(async () => undefined),
      ping: jest.fn(async () => 'PONG'),
    };
    const repo = new HealthRepository(prisma, redis);

    await expect(repo.pingPostgres()).resolves.toBe(true);
    await expect(repo.pingRedis()).resolves.toBe(true);
    expect(prisma.$queryRaw).toHaveBeenCalled();
    expect(redis.ping).toHaveBeenCalled();
  });

  it('returns false when postgres or redis throws', async () => {
    const prisma = {
      $queryRaw: jest.fn(async () => {
        throw new Error('db down');
      }),
    } as unknown as PrismaClient;
    const redis = {
      isOpen: true,
      connect: jest.fn(async () => undefined),
      ping: jest.fn(async () => {
        throw new Error('redis down');
      }),
    };
    const repo = new HealthRepository(prisma, redis);

    await expect(repo.pingPostgres()).resolves.toBe(false);
    await expect(repo.pingRedis()).resolves.toBe(false);
  });
});
