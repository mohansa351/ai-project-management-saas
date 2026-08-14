import { Router } from 'express';
import type { AuthController } from '../../controllers/authController.js';

export function createAuthRouter(authController: AuthController): Router {
  const router = Router();
  router.post('/register', authController.register);
  return router;
}
