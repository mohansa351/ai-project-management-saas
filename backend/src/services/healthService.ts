import type { HealthRepository } from '../repositories/healthRepository.js';

export type DependencyStatus = 'up' | 'down';
export type ReadinessStatus = 'ok' | 'degraded' | 'unhealthy';

export type Readiness = {
  status: ReadinessStatus;
  postgres: DependencyStatus;
  redis: DependencyStatus;
  uptime: number;
};

export class HealthService {
  constructor(
    private readonly repository: HealthRepository,
    private readonly uptime: () => number = () => process.uptime(),
  ) {}

  async getReadiness(): Promise<Readiness> {
    const [postgresUp, redisUp] = await Promise.all([
      this.repository.pingPostgres(),
      this.repository.pingRedis(),
    ]);

    const postgres: DependencyStatus = postgresUp ? 'up' : 'down';
    const redis: DependencyStatus = redisUp ? 'up' : 'down';
    const status: ReadinessStatus =
      postgresUp && redisUp ? 'ok' : postgresUp || redisUp ? 'degraded' : 'unhealthy';

    return { status, postgres, redis, uptime: this.uptime() };
  }
}
