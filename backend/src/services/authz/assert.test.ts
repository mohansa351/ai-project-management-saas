import { describe, expect, it, jest } from '@jest/globals';
import type { Organization, OrganizationMember } from '@prisma/client';
import { AppError } from '../../lib/http/appError.js';
import { AUTHZ_FORBIDDEN_MESSAGE, ORGANIZATION_NOT_FOUND_MESSAGE } from '../../lib/http/orgErrors.js';
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

function repos(options: {
  organization?: Organization | null;
  member?: OrganizationMember | null;
}) {
  return {
    organizationRepository: {
      findLiveById: jest.fn(async () => options.organization ?? null),
    },
    organizationMemberRepository: {
      findActiveByOrgAndUser: jest.fn(async () => options.member ?? null),
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
  it('stubs Epic 4 with AUTHZ_FORBIDDEN', async () => {
    await expect(assertProjectMember({ userId: 'user_1', projectId: 'proj_1' })).rejects.toMatchObject({
      code: 'AUTHZ_FORBIDDEN',
      statusCode: 403,
    });
  });
});
