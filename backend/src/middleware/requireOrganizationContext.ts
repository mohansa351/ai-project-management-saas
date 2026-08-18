import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../lib/http/appError.js';
import { AUTH_SESSION_UNAUTHORIZED_MESSAGE } from '../lib/http/authErrors.js';
import { ORG_CONTEXT_REQUIRED_MESSAGE } from '../lib/http/orgErrors.js';
import { assertOrgMember, type OrgAuthzRepos } from '../services/authz/assert.js';

function sessionUnauthorized(): AppError {
  return new AppError('AUTH_UNAUTHORIZED', AUTH_SESSION_UNAUTHORIZED_MESSAGE, 401);
}

function missingOrgContext(): AppError {
  return new AppError('VALIDATION_ERROR', ORG_CONTEXT_REQUIRED_MESSAGE, 400, {
    'x-organization-id': [ORG_CONTEXT_REQUIRED_MESSAGE],
  });
}

export function createRequireOrganizationContext(repos: OrgAuthzRepos) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw sessionUnauthorized();
      }
      const header = req.get('x-organization-id');
      const organizationId = typeof header === 'string' ? header.trim() : '';
      if (!organizationId) {
        throw missingOrgContext();
      }
      await assertOrgMember(repos, req.user.id, organizationId);
      req.organizationId = organizationId;
      next();
    } catch (err) {
      next(err);
    }
  };
}
