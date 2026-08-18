import { Router, type RequestHandler } from 'express';
import type { AuthController } from '../../controllers/authController.js';
import type { HealthController } from '../../controllers/healthController.js';
import type { OrganizationController } from '../../controllers/organizationController.js';
import { createAuthRouter } from './auth.js';
import { createOrganizationsRouter } from './organizations.js';

export function createV1Router(
  healthController: HealthController,
  authController: AuthController,
  organizationController: OrganizationController,
  authRateLimit?: RequestHandler,
  requireAccessToken?: RequestHandler,
): Router {
  const router = Router();
  router.get('/health', healthController.getHealth);
  router.use('/auth', createAuthRouter(authController, authRateLimit, requireAccessToken));
  router.use('/organizations', createOrganizationsRouter(organizationController, requireAccessToken));
  return router;
}
