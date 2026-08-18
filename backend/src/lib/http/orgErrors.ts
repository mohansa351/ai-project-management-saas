export const AUTHZ_FORBIDDEN_MESSAGE = 'You do not have permission to perform this action.';
export const ORG_CONTEXT_REQUIRED_MESSAGE = 'X-Organization-Id is required.';
export const ORG_CONTEXT_MISMATCH_MESSAGE =
  'X-Organization-Id must match the organization in the request path.';
export const ORGANIZATION_NOT_FOUND_MESSAGE = 'Organization not found.';
export const ORG_INVITE_TOKEN_INVALID_MESSAGE = 'This invite link is invalid or has expired.';
export const ALREADY_ACTIVE_MEMBER_ERROR = {
  message: 'This user is already an active member of the organization.',
  details: { email: ['This user is already an active member of the organization'] },
} as const;
export const LAST_ACTIVE_ORG_ADMIN_ERROR = {
  message: 'Cannot demote or remove the last active organization admin.',
  details: { memberId: ['Cannot demote or remove the last active organization admin'] },
} as const;
export const SLUG_TAKEN_ERROR = {
  message: 'This slug is already taken.',
  details: { slug: ['This slug is already taken'] },
} as const;
