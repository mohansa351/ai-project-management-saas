export const PROJECT_NOT_FOUND_MESSAGE = 'Project not found.';
export const PROJECT_MEMBER_NOT_FOUND_MESSAGE = 'Project member not found.';
export const INVALID_PROJECT_OWNER_ERROR = {
  message: 'ownerId must be an active member of the project organization.',
  details: { ownerId: ['ownerId must be an active member of the project organization'] },
} as const;
export const INVALID_PROJECT_MEMBER_USER_ERROR = {
  message: 'userId must be an active member of the project organization.',
  details: { userId: ['userId must be an active member of the project organization'] },
} as const;
export const DUPLICATE_PROJECT_MEMBER_ERROR = {
  message: 'This user is already a member of the project.',
  details: { userId: ['This user is already a member of the project'] },
} as const;
export const PROJECT_DATE_RANGE_ERROR = {
  message: 'dueDate must be on or after startDate.',
  details: { dueDate: ['dueDate must be on or after startDate'] },
} as const;
export const PROJECT_ORG_MISMATCH_ERROR = {
  message: 'organizationId must match X-Organization-Id.',
  details: { organizationId: ['organizationId must match X-Organization-Id'] },
} as const;
