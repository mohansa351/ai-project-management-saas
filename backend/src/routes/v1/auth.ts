import { Router, type RequestHandler } from 'express';
import type { AuthController } from '../../controllers/authController.js';

export function createAuthRouter(
  authController: AuthController,
  authRateLimit?: RequestHandler,
): Router {
  const router = Router();
  const limit = authRateLimit ?? ((_req, _res, next) => next());
  router.post('/register', limit, authController.register);
  router.post('/login', limit, authController.login);
  router.post('/logout', authController.logout);
  router.post('/verify-email', authController.verifyEmail);
  router.post('/resend-verification', authController.resendVerification);
  return router;
}
