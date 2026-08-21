import { Router, type RequestHandler } from 'express';
import type { ProjectController } from '../../controllers/projectController.js';

export function createProjectsRouter(
  projectController: ProjectController,
  requireAccessToken?: RequestHandler,
  requireOrganizationContext?: RequestHandler,
): Router {
  const router = Router();
  const requireAuth = requireAccessToken ?? ((_req, _res, next) => next());
  const requireOrgContext = requireOrganizationContext ?? ((_req, _res, next) => next());
  router.post('/', requireAuth, requireOrgContext, projectController.create);
  router.get('/', requireAuth, requireOrgContext, projectController.list);
  router.get('/:id', requireAuth, projectController.getById);
  router.patch('/:id', requireAuth, projectController.patch);
  router.delete('/:id', requireAuth, projectController.remove);
  return router;
}
