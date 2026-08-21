import type {
  Organization,
  OrganizationMember,
  OrgRole,
  Project,
  ProjectMember,
  SystemRole,
} from '@prisma/client';
import { AppError } from '../../lib/http/appError.js';
import { AUTHZ_FORBIDDEN_MESSAGE, ORGANIZATION_NOT_FOUND_MESSAGE } from '../../lib/http/orgErrors.js';
import { PROJECT_NOT_FOUND_MESSAGE } from '../../lib/http/projectErrors.js';
import type { OrganizationMemberRepository } from '../../repositories/organizationMemberRepository.js';
import type { OrganizationRepository } from '../../repositories/organizationRepository.js';
import type { ProjectMemberRepository } from '../../repositories/projectMemberRepository.js';
import type { ProjectRepository } from '../../repositories/projectRepository.js';
import { canAccessAnyOrgProject, hasPermission, type OrgPermission } from './permissions.js';

export type OrgAuthzRepos = {
  organizationRepository: Pick<OrganizationRepository, 'findLiveById'>;
  organizationMemberRepository: Pick<OrganizationMemberRepository, 'findActiveByOrgAndUser'>;
};

export type ProjectAuthzRepos = OrgAuthzRepos & {
  projectRepository: Pick<ProjectRepository, 'findLiveById'>;
  projectMemberRepository: Pick<ProjectMemberRepository, 'findByProjectAndUser'>;
};

function forbidden(): AppError {
  return new AppError('AUTHZ_FORBIDDEN', AUTHZ_FORBIDDEN_MESSAGE, 403);
}

function orgNotFound(): AppError {
  return new AppError('NOT_FOUND', ORGANIZATION_NOT_FOUND_MESSAGE, 404);
}

function projectNotFound(): AppError {
  return new AppError('NOT_FOUND', PROJECT_NOT_FOUND_MESSAGE, 404);
}

export async function assertOrgMember(
  repos: OrgAuthzRepos,
  userId: string,
  organizationId: string,
): Promise<{ organization: Organization; member: OrganizationMember }> {
  const organization = await repos.organizationRepository.findLiveById(organizationId);
  if (!organization) {
    throw orgNotFound();
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

/** AD-4: live project, ACTIVE org membership, then ORG_ADMIN or ProjectMember. */
export async function assertProjectMember(
  repos: ProjectAuthzRepos,
  userId: string,
  projectId: string,
): Promise<{
  project: Project;
  organization: Organization;
  member: OrganizationMember;
  projectMember: ProjectMember | null;
}> {
  const project = await repos.projectRepository.findLiveById(projectId);
  if (!project) {
    throw projectNotFound();
  }
  const { organization, member } = await assertOrgMember(repos, userId, project.organizationId);
  if (canAccessAnyOrgProject(member.role)) {
    const projectMember = await repos.projectMemberRepository.findByProjectAndUser(projectId, userId);
    return { project, organization, member, projectMember };
  }
  const projectMember = await repos.projectMemberRepository.findByProjectAndUser(projectId, userId);
  if (!projectMember) {
    throw forbidden();
  }
  return { project, organization, member, projectMember };
}
