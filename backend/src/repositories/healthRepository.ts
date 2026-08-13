import type { PrismaClient } from '@prisma/client';

type RedisLike = {
  isOpen: boolean;
  connect: () => Promise<unknown>;
  ping: () => Promise<string>;
};

export class HealthRepository {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly redis: RedisLike,
  ) {}

  async pingPostgres(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }

  async pingRedis(): Promise<boolean> {
    try {
      if (!this.redis.isOpen) {
        await this.redis.connect();
      }
      const result = await this.redis.ping();
      return result === 'PONG';
    } catch {
      return false;
    }
  }
}
