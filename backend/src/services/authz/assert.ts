import type { Organization, OrganizationMember, OrgRole, SystemRole } from '@prisma/client';
import { AppError } from '../../lib/http/appError.js';
import { AUTHZ_FORBIDDEN_MESSAGE, ORGANIZATION_NOT_FOUND_MESSAGE } from '../../lib/http/orgErrors.js';
import type { OrganizationMemberRepository } from '../../repositories/organizationMemberRepository.js';
import type { OrganizationRepository } from '../../repositories/organizationRepository.js';
import { hasPermission, type OrgPermission } from './permissions.js';

export type OrgAuthzRepos = {
  organizationRepository: Pick<OrganizationRepository, 'findLiveById'>;
  organizationMemberRepository: Pick<OrganizationMemberRepository, 'findActiveByOrgAndUser'>;
};

function forbidden(): AppError {
  return new AppError('AUTHZ_FORBIDDEN', AUTHZ_FORBIDDEN_MESSAGE, 403);
}

function notFound(): AppError {
  return new AppError('NOT_FOUND', ORGANIZATION_NOT_FOUND_MESSAGE, 404);
}

export async function assertOrgMember(
  repos: OrgAuthzRepos,
  userId: string,
  organizationId: string,
): Promise<{ organization: Organization; member: OrganizationMember }> {
  const organization = await repos.organizationRepository.findLiveById(organizationId);
  if (!organization) {
    throw notFound();
  }
  const member = await repos.organizationMemberRepository.findActiveByOrgAndUser(organizationId, userId);
  if (!member || member.status !== 'ACTIVE') {
    throw forbidden();
  }
  return { organization, member };
}

export function assertPermission(role: OrgRole, permission: OrgPermission): void {
  if (!hasPermission(role, permission)) {
    throw forbidden();
  }
}

export function assertSuperAdmin(systemRole: SystemRole): void {
  if (systemRole !== 'SUPER_ADMIN') {
    throw forbidden();
  }
}

/** Epic 4 will resolve ProjectMember. Until then every call is forbidden. */
export async function assertProjectMember(input: {
  userId: string;
  projectId: string;
}): Promise<never> {
  void input;
  throw forbidden();
}
