import { describe, expect, it } from '@jest/globals';
import type { OrgRole } from '@prisma/client';
import { canAccessAnyOrgProject, hasPermission, type OrgPermission } from './permissions.js';

const ORG_ADMIN_ONLY: OrgPermission[] = ['org.manage', 'org.invite', 'org.members.manage'];
const PROJECT_MANAGER_EXTRAS: OrgPermission[] = ['project.create', 'project.members.manage'];
const TEAM_BASE: OrgPermission[] = ['task.crud', 'task.status', 'ai.use'];

const ALL: OrgPermission[] = [...ORG_ADMIN_ONLY, ...PROJECT_MANAGER_EXTRAS, ...TEAM_BASE];

describe('org permission matrix', () => {
  it.each<[OrgRole, OrgPermission[], OrgPermission[]]>([
    ['ORG_ADMIN', ALL, []],
    ['PROJECT_MANAGER', [...PROJECT_MANAGER_EXTRAS, ...TEAM_BASE], ORG_ADMIN_ONLY],
    ['TEAM_MEMBER', TEAM_BASE, [...ORG_ADMIN_ONLY, ...PROJECT_MANAGER_EXTRAS]],
  ])('%s allows expected permissions and denies the rest', (role, allowed, denied) => {
    expect([...allowed, ...denied].sort()).toEqual([...ALL].sort());
    for (const permission of ALL) {
      expect(hasPermission(role, permission)).toBe(allowed.includes(permission));
    }
  });

  it('denies unknown roles instead of throwing', () => {
    expect(hasPermission('NOT_A_ROLE' as OrgRole, 'org.manage')).toBe(false);
  });

  it('gives ORG_ADMIN org-wide project access and withholds it from other roles', () => {
    expect(canAccessAnyOrgProject('ORG_ADMIN')).toBe(true);
    expect(canAccessAnyOrgProject('PROJECT_MANAGER')).toBe(false);
    expect(canAccessAnyOrgProject('TEAM_MEMBER')).toBe(false);
  });
});
