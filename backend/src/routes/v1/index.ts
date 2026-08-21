import { Router, type RequestHandler } from 'express';
import type { AuthController } from '../../controllers/authController.js';
import type { HealthController } from '../../controllers/healthController.js';
import type { OrganizationController } from '../../controllers/organizationController.js';
import type { ProjectController } from '../../controllers/projectController.js';
import { createAuthRouter } from './auth.js';
import { createOrganizationsRouter } from './organizations.js';
import { createProjectsRouter } from './projects.js';

export function createV1Router(
  healthController: HealthController,
  authController: AuthController,
  organizationController: OrganizationController,
  projectController: ProjectController,
  authRateLimit?: RequestHandler,
  requireAccessToken?: RequestHandler,
  requireOrganizationContext?: RequestHandler,
): Router {
  const router = Router();
  router.get('/health', healthController.getHealth);
  router.use('/auth', createAuthRouter(authController, authRateLimit, requireAccessToken));
  router.use(
    '/organizations',
    createOrganizationsRouter(organizationController, requireAccessToken, requireOrganizationContext),
  );
  router.use(
    '/projects',
    createProjectsRouter(projectController, requireAccessToken, requireOrganizationContext),
  );
  return router;
}
