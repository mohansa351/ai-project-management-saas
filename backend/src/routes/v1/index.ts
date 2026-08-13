import { Router } from 'express';
import type { HealthController } from '../../controllers/healthController.js';

export function createV1Router(healthController: HealthController): Router {
  const router = Router();
  router.get('/health', healthController.getHealth);
  return router;
}
