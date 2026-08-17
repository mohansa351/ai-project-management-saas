import { env } from './config/env.js';
import { createApp } from './app.js';
import { AuthController } from './controllers/authController.js';
import { HealthController } from './controllers/healthController.js';
import { ConsoleEmailProvider } from './lib/email/emailProvider.js';
import { logger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';
import { redis } from './lib/redis.js';
import { createAuthRateLimit } from './middleware/authRateLimit.js';
import { EmailVerificationTokenRepository } from './repositories/emailVerificationTokenRepository.js';
import { HealthRepository } from './repositories/healthRepository.js';
import { RefreshTokenRepository } from './repositories/refreshTokenRepository.js';
import { UserRepository } from './repositories/userRepository.js';
import { AuthService } from './services/authService.js';
import { EmailVerificationService } from './services/emailVerificationService.js';
import { HealthService } from './services/healthService.js';

const healthController = new HealthController(
  new HealthService(new HealthRepository(prisma, redis)),
);
const userRepository = new UserRepository(prisma);
const emailVerificationService = new EmailVerificationService(
  userRepository,
  new EmailVerificationTokenRepository(prisma),
  new ConsoleEmailProvider(),
  prisma,
);
const authService = new AuthService(
  userRepository,
  (user) =>
    emailVerificationService.issueAndSend(user).catch((err) => {
      logger.warn({ err }, 'verification email failed');
    }),
  new RefreshTokenRepository(prisma),
);
const authController = new AuthController(authService, emailVerificationService);
const app = createApp({
  healthController,
  authController,
  authRateLimit: env.NODE_ENV === 'test' ? undefined : createAuthRateLimit(redis),
});

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
