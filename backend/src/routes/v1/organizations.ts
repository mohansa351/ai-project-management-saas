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
  router.post('/:id/members/invite', requireAuth, organizationController.invite);
  router.post('/:id/members/accept', requireAuth, organizationController.accept);
  router.get('/:id/members', requireAuth, organizationController.listMembers);
  router.patch('/:id/members/:memberId', requireAuth, organizationController.patchMember);
  router.delete('/:id/members/:memberId', requireAuth, organizationController.removeMember);
  return router;
}
