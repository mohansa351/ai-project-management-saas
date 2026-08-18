import { Router, type RequestHandler } from 'express';
import type { OrganizationController } from '../../controllers/organizationController.js';

export function createOrganizationsRouter(
  organizationController: OrganizationController,
  requireAccessToken?: RequestHandler,
): Router {
  const router = Router();
  const requireAuth = requireAccessToken ?? ((_req, _res, next) => next());
  router.post('/', requireAuth, organizationController.create);
  router.get('/', requireAuth, organizationController.list);
  router.get('/:id', requireAuth, organizationController.getById);
  router.patch('/:id', requireAuth, organizationController.patch);
  router.delete('/:id', requireAuth, organizationController.remove);
  return router;
}
