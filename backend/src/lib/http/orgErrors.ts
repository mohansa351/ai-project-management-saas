export const AUTHZ_FORBIDDEN_MESSAGE = 'You do not have permission to perform this action.';
export const ORGANIZATION_NOT_FOUND_MESSAGE = 'Organization not found.';
export const ORG_INVITE_TOKEN_INVALID_MESSAGE = 'This invite link is invalid or has expired.';
export const ALREADY_ACTIVE_MEMBER_ERROR = {
  message: 'This user is already an active member of the organization.',
  details: { email: ['This user is already an active member of the organization'] },
} as const;
export const SLUG_TAKEN_ERROR = {
  message: 'This slug is already taken.',
  details: { slug: ['This slug is already taken'] },
} as const;
