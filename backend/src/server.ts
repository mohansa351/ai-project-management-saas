import { env } from './config/env.js';
import { createApp } from './app.js';
import { AuthController } from './controllers/authController.js';
import { HealthController } from './controllers/healthController.js';
import { OrganizationController } from './controllers/organizationController.js';
import { ProjectController } from './controllers/projectController.js';
import { createEmailProvider } from './lib/email/emailProvider.js';
import { logger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';
import { redis } from './lib/redis.js';
import { createAuthRateLimit } from './middleware/authRateLimit.js';
import { createRequireAccessToken } from './middleware/requireAccessToken.js';
import { createRequireOrganizationContext } from './middleware/requireOrganizationContext.js';
import { EmailVerificationTokenRepository } from './repositories/emailVerificationTokenRepository.js';
import { HealthRepository } from './repositories/healthRepository.js';
import { PasswordResetTokenRepository } from './repositories/passwordResetTokenRepository.js';
import { RefreshTokenRepository } from './repositories/refreshTokenRepository.js';
import { OrganizationInviteRepository } from './repositories/organizationInviteRepository.js';
import { OrganizationMemberRepository } from './repositories/organizationMemberRepository.js';
import { OrganizationRepository } from './repositories/organizationRepository.js';
import { ProjectMemberRepository } from './repositories/projectMemberRepository.js';
import { ProjectRepository } from './repositories/projectRepository.js';
import { UserRepository } from './repositories/userRepository.js';
import { AuthService } from './services/authService.js';
import { EmailVerificationService } from './services/emailVerificationService.js';
import { HealthService } from './services/healthService.js';
import { OrganizationInviteService } from './services/organizationInviteService.js';
import { OrganizationMemberService } from './services/organizationMemberService.js';
import { OrganizationService } from './services/organizationService.js';
import { ProjectService } from './services/projectService.js';
import { PasswordResetService } from './services/passwordResetService.js';

const healthController = new HealthController(
  new HealthService(new HealthRepository(prisma, redis)),
);
const userRepository = new UserRepository(prisma);
const emailProvider = createEmailProvider(
  env.SMTP_HOST
    ? {
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_SECURE,
        from: env.EMAIL_FROM,
        user: env.SMTP_USER,
        pass: env.SMTP_PASS,
      }
    : undefined,
);
const refreshTokenRepository = new RefreshTokenRepository(prisma);
const passwordResetTokenRepository = new PasswordResetTokenRepository(prisma);
const emailVerificationService = new EmailVerificationService(
  userRepository,
  new EmailVerificationTokenRepository(prisma),
  emailProvider,
  prisma,
);
const passwordResetService = new PasswordResetService(
  userRepository,
  passwordResetTokenRepository,
  refreshTokenRepository,
  emailProvider,
  prisma,
);
const authService = new AuthService(
  userRepository,
  (user) =>
    emailVerificationService.issueAndSend(user).catch((err) => {
      logger.warn({ err }, 'verification email failed');
    }),
  refreshTokenRepository,
  passwordResetTokenRepository,
  prisma,
);
const authController = new AuthController(authService, emailVerificationService, passwordResetService);
const organizationMemberRepository = new OrganizationMemberRepository(prisma);
const organizationRepository = new OrganizationRepository(prisma);
const organizationInviteRepository = new OrganizationInviteRepository(prisma);
const projectRepository = new ProjectRepository(prisma);
const projectMemberRepository = new ProjectMemberRepository(prisma);
const projectController = new ProjectController(
  new ProjectService(
    projectRepository,
    projectMemberRepository,
    organizationRepository,
    organizationMemberRepository,
    prisma,
  ),
);
const organizationController = new OrganizationController(
  new OrganizationService(organizationRepository, organizationMemberRepository, prisma),
  new OrganizationInviteService(
    organizationRepository,
    organizationMemberRepository,
    organizationInviteRepository,
    userRepository,
    emailProvider,
    prisma,
  ),
  new OrganizationMemberService(
    organizationRepository,
    organizationMemberRepository,
    organizationInviteRepository,
    prisma,
  ),
);
const app = createApp({
  healthController,
  authController,
  organizationController,
  projectController,
  authRateLimit: env.NODE_ENV === 'test' ? undefined : createAuthRateLimit(redis),
  requireAccessToken: createRequireAccessToken(userRepository),
  requireOrganizationContext: createRequireOrganizationContext({
    organizationRepository,
    organizationMemberRepository,
  }),
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
