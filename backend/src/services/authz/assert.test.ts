import { describe, expect, it, jest } from '@jest/globals';
import type { Organization, OrganizationMember, Project, ProjectMember } from '@prisma/client';
import { AppError } from '../../lib/http/appError.js';
import { AUTHZ_FORBIDDEN_MESSAGE, ORGANIZATION_NOT_FOUND_MESSAGE } from '../../lib/http/orgErrors.js';
import { PROJECT_NOT_FOUND_MESSAGE } from '../../lib/http/projectErrors.js';
import {
  assertOrgMember,
  assertPermission,
  assertProjectMember,
  assertSuperAdmin,
} from './assert.js';

const now = new Date('2026-08-18T00:00:00.000Z');

const liveOrg: Organization = {
  id: 'org_a',
  name: 'Acme',
  slug: 'acme',
  createdAt: now,
  updatedAt: now,
  deletedAt: null,
};

const liveProject: Project = {
  id: 'proj_1',
  organizationId: 'org_a',
  name: 'Website',
  description: null,
  status: 'ACTIVE',
  priority: 'MEDIUM',
  startDate: null,
  dueDate: null,
  ownerId: 'user_1',
  createdAt: now,
  updatedAt: now,
  deletedAt: null,
};

function member(role: OrganizationMember['role'], status: OrganizationMember['status']): OrganizationMember {
  return {
    id: 'mem_1',
    organizationId: 'org_a',
    userId: 'user_1',
    role,
    status,
    createdAt: now,
    updatedAt: now,
  };
}

function projectMember(): ProjectMember {
  return {
    id: 'pm_1',
    projectId: 'proj_1',
    userId: 'user_1',
    createdAt: now,
    updatedAt: now,
  };
}

function repos(options: {
  organization?: Organization | null;
  member?: OrganizationMember | null;
  project?: Project | null;
  projectMember?: ProjectMember | null;
}) {
  return {
    organizationRepository: {
      findLiveById: jest.fn(async () => options.organization ?? null),
    },
    organizationMemberRepository: {
      findActiveByOrgAndUser: jest.fn(async () => options.member ?? null),
    },
    projectRepository: {
      findLiveById: jest.fn(async () => options.project ?? null),
    },
    projectMemberRepository: {
      findByProjectAndUser: jest.fn(async () => options.projectMember ?? null),
    },
  };
}

describe('assertOrgMember', () => {
  it('returns live org and ACTIVE member', async () => {
    const active = member('TEAM_MEMBER', 'ACTIVE');
    const result = await assertOrgMember(repos({ organization: liveOrg, member: active }), 'user_1', 'org_a');
    expect(result.organization.id).toBe('org_a');
    expect(result.member.role).toBe('TEAM_MEMBER');
  });

  it('throws 404 NOT_FOUND when the org is missing or not live', async () => {
    const deps = repos({ organization: null, member: null });
    await expect(assertOrgMember(deps, 'user_1', 'missing')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      statusCode: 404,
      message: ORGANIZATION_NOT_FOUND_MESSAGE,
    });
    expect(deps.organizationMemberRepository.findActiveByOrgAndUser).not.toHaveBeenCalled();
  });

  it('throws 403 AUTHZ_FORBIDDEN for strangers and PENDING rows', async () => {
    await expect(assertOrgMember(repos({ organization: liveOrg, member: null }), 'user_2', 'org_a')).rejects.toMatchObject({
      code: 'AUTHZ_FORBIDDEN',
      statusCode: 403,
      message: AUTHZ_FORBIDDEN_MESSAGE,
    });
    await expect(
      assertOrgMember(repos({ organization: liveOrg, member: member('TEAM_MEMBER', 'PENDING') }), 'user_1', 'org_a'),
    ).rejects.toMatchObject({
      code: 'AUTHZ_FORBIDDEN',
      statusCode: 403,
    });
  });
});

describe('assertPermission', () => {
  it('allows ORG_ADMIN to manage the org', () => {
    expect(() => assertPermission('ORG_ADMIN', 'org.manage')).not.toThrow();
  });

  it('forbids TEAM_MEMBER and PROJECT_MANAGER from org-admin-only actions', () => {
    expect(() => assertPermission('TEAM_MEMBER', 'org.manage')).toThrow(AppError);
    expect(() => assertPermission('PROJECT_MANAGER', 'org.invite')).toThrow(AppError);
    try {
      assertPermission('TEAM_MEMBER', 'org.manage');
    } catch (err) {
      expect(err).toMatchObject({ code: 'AUTHZ_FORBIDDEN', statusCode: 403 });
    }
  });
});

describe('assertSuperAdmin', () => {
  it('allows SUPER_ADMIN and forbids USER', () => {
    expect(() => assertSuperAdmin('SUPER_ADMIN')).not.toThrow();
    try {
      assertSuperAdmin('USER');
      throw new Error('expected AUTHZ_FORBIDDEN');
    } catch (err) {
      expect(err).toMatchObject({ code: 'AUTHZ_FORBIDDEN', statusCode: 403 });
    }
  });
});

describe('assertProjectMember', () => {
  it('allows ORG_ADMIN without a ProjectMember row', async () => {
    const result = await assertProjectMember(
      repos({
        organization: liveOrg,
        member: member('ORG_ADMIN', 'ACTIVE'),
        project: liveProject,
        projectMember: null,
      }),
      'user_1',
      'proj_1',
    );
    expect(result.project.id).toBe('proj_1');
    expect(result.projectMember).toBeNull();
  });

  it('allows PROJECT_MANAGER with a ProjectMember row', async () => {
    const row = projectMember();
    const result = await assertProjectMember(
      repos({
        organization: liveOrg,
        member: member('PROJECT_MANAGER', 'ACTIVE'),
        project: liveProject,
        projectMember: row,
      }),
      'user_1',
      'proj_1',
    );
    expect(result.projectMember?.id).toBe(row.id);
  });

  it('forbids PROJECT_MANAGER without ProjectMember', async () => {
    await expect(
      assertProjectMember(
        repos({
          organization: liveOrg,
          member: member('PROJECT_MANAGER', 'ACTIVE'),
          project: liveProject,
          projectMember: null,
        }),
        'user_1',
        'proj_1',
      ),
    ).rejects.toMatchObject({ code: 'AUTHZ_FORBIDDEN', statusCode: 403 });
  });

  it('throws 404 NOT_FOUND for missing or soft-deleted projects before membership', async () => {
    const deps = repos({
      organization: liveOrg,
      member: member('ORG_ADMIN', 'ACTIVE'),
      project: null,
    });
    await expect(assertProjectMember(deps, 'user_1', 'missing')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      statusCode: 404,
      message: PROJECT_NOT_FOUND_MESSAGE,
    });
    expect(deps.organizationRepository.findLiveById).not.toHaveBeenCalled();
  });
});
