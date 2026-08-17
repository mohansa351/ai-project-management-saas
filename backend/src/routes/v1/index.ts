import { Router, type RequestHandler } from 'express';
import type { AuthController } from '../../controllers/authController.js';
import type { HealthController } from '../../controllers/healthController.js';
import { createAuthRouter } from './auth.js';

export function createV1Router(
  healthController: HealthController,
  authController: AuthController,
  authRateLimit?: RequestHandler,
  requireAccessToken?: RequestHandler,
): Router {
  const router = Router();
  router.get('/health', healthController.getHealth);
  router.use('/auth', createAuthRouter(authController, authRateLimit, requireAccessToken));
  return router;
}
