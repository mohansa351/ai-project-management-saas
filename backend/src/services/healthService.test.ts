import { describe, expect, it, jest } from '@jest/globals';
import { HealthService } from './healthService.js';
import type { HealthRepository } from '../repositories/healthRepository.js';

describe('HealthService', () => {
  it('reports ok when both dependencies are up', async () => {
    const repository = {
      pingPostgres: jest.fn(async () => true),
      pingRedis: jest.fn(async () => true),
    } as unknown as HealthRepository;
    const service = new HealthService(repository, () => 9);
    await expect(service.getReadiness()).resolves.toEqual({
      status: 'ok',
      postgres: 'up',
      redis: 'up',
      uptime: 9,
    });
  });

  it('reports degraded when one dependency is down', async () => {
    const repository = {
      pingPostgres: jest.fn(async () => false),
      pingRedis: jest.fn(async () => true),
    } as unknown as HealthRepository;
    const service = new HealthService(repository, () => 1);
    const data = await service.getReadiness();
    expect(data.status).toBe('degraded');
    expect(data.postgres).toBe('down');
  });

  it('reports unhealthy when both dependencies are down', async () => {
    const repository = {
      pingPostgres: jest.fn(async () => false),
      pingRedis: jest.fn(async () => false),
    } as unknown as HealthRepository;
    const service = new HealthService(repository, () => 1);
    await expect(service.getReadiness()).resolves.toMatchObject({
      status: 'unhealthy',
      postgres: 'down',
      redis: 'down',
    });
  });
});
