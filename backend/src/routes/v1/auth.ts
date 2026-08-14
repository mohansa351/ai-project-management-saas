import { Router } from 'express';
import type { AuthController } from '../../controllers/authController.js';

export function createAuthRouter(authController: AuthController): Router {
  const router = Router();
  router.post('/register', authController.register);
  router.post('/verify-email', authController.verifyEmail);
  router.post('/resend-verification', authController.resendVerification);
  return router;
}
