import { env } from './config/env.js';
import { createApp } from './app.js';
import { AuthController } from './controllers/authController.js';
import { HealthController } from './controllers/healthController.js';
import { logger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';
import { redis } from './lib/redis.js';
import { HealthRepository } from './repositories/healthRepository.js';
import { UserRepository } from './repositories/userRepository.js';
import { AuthService } from './services/authService.js';
import { HealthService } from './services/healthService.js';

const healthController = new HealthController(
  new HealthService(new HealthRepository(prisma, redis)),
);
const authController = new AuthController(
  new AuthService(new UserRepository(prisma), async () => undefined),
);
const app = createApp({ healthController, authController });

const server = app.listen(env.PORT, '0.0.0.0', () => {
  logger.info({ port: env.PORT }, 'API listening');
});

server.on('error', (err: Error) => {
  logger.error({ err }, 'listen failed');
  process.exit(1);
});

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  logger.info({ signal }, 'shutting down');
  server.close();
  await prisma.$disconnect().catch(() => undefined);
  if (redis.isOpen) {
    await redis.quit().catch(() => undefined);
  }
  process.exit(0);
}

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});
process.on('SIGINT', () => {
  void shutdown('SIGINT');
});
