import type { OrgRole } from '@prisma/client';

export type OrgPermission =
  | 'org.manage'
  | 'org.invite'
  | 'org.members.manage'
  | 'project.create'
  | 'project.members.manage'
  | 'task.crud'
  | 'task.status'
  | 'ai.use';

const ALL_ORG_PERMISSIONS: readonly OrgPermission[] = [
  'org.manage',
  'org.invite',
  'org.members.manage',
  'project.create',
  'project.members.manage',
  'task.crud',
  'task.status',
  'ai.use',
];

const PROJECT_AND_WORK: readonly OrgPermission[] = [
  'project.create',
  'project.members.manage',
  'task.crud',
  'task.status',
  'ai.use',
];

const TEAM_MEMBER_PERMISSIONS: readonly OrgPermission[] = ['task.crud', 'task.status', 'ai.use'];

export const ROLE_PERMISSIONS: Record<OrgRole, ReadonlySet<OrgPermission>> = {
  ORG_ADMIN: new Set(ALL_ORG_PERMISSIONS),
  PROJECT_MANAGER: new Set(PROJECT_AND_WORK),
  TEAM_MEMBER: new Set(TEAM_MEMBER_PERMISSIONS),
};

export function hasPermission(role: OrgRole, permission: OrgPermission): boolean {
  return ROLE_PERMISSIONS[role]?.has(permission) === true;
}

/** AD-4: org-wide project access without a ProjectMember row. */
export function canAccessAnyOrgProject(role: OrgRole): boolean {
  return role === 'ORG_ADMIN';
}
