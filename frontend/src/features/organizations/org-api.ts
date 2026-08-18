import { apiJson, type ApiEnvelope } from '@/lib/api/client';

export type OrgRole = 'ORG_ADMIN' | 'PROJECT_MANAGER' | 'TEAM_MEMBER';
export type MembershipStatus = 'ACTIVE' | 'PENDING';

export type CallerOrganizationMembership = {
  role: OrgRole;
  status: MembershipStatus;
};

export type PublicOrganization = {
  id: string;
  name: string;
  slug: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  membership: CallerOrganizationMembership;
};

export type PublicOrganizationMember = {
  id: string;
  organizationId: string;
  userId: string;
  role: OrgRole;
  status: MembershipStatus;
  createdAt: string;
  updatedAt: string;
  user: {
    id: string;
    email: string;
    name: string;
  };
};

export const organizationsQueryKey = ['organizations'] as const;

export function orgQueryKey(organizationId: string, ...parts: string[]): readonly unknown[] {
  return ['org', organizationId, ...parts];
}

export function isCurrentOrgAdmin(
  organizations: PublicOrganization[] | undefined,
  currentOrganizationId: string | null,
): boolean {
  if (!currentOrganizationId || !organizations) {
    return false;
  }
  const membership = organizations.find((org) => org.id === currentOrganizationId)?.membership;
  return membership?.status === 'ACTIVE' && membership.role === 'ORG_ADMIN';
}

function jsonInit(method: string, body?: unknown): RequestInit {
  if (body === undefined) {
    return { method };
  }
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

export async function listOrganizationsRequest(): Promise<
  ApiEnvelope<{ organizations: PublicOrganization[] }>
> {
  return apiJson<{ organizations: PublicOrganization[] }>('/organizations?page=1&pageSize=100');
}

export async function createOrganizationRequest(input: {
  name: string;
  slug?: string;
}): Promise<ApiEnvelope<{ organization: PublicOrganization }>> {
  const body: { name: string; slug?: string } = { name: input.name };
  if (input.slug) {
    body.slug = input.slug;
  }
  return apiJson<{ organization: PublicOrganization }>('/organizations', jsonInit('POST', body));
}

export async function listMembersRequest(
  organizationId: string,
): Promise<ApiEnvelope<{ members: PublicOrganizationMember[] }>> {
  return apiJson<{ members: PublicOrganizationMember[] }>(
    `/organizations/${organizationId}/members?page=1&pageSize=100`,
  );
}

export async function inviteMemberRequest(
  organizationId: string,
  input: { email: string; role: OrgRole },
): Promise<ApiEnvelope<{ invite: unknown }>> {
  return apiJson<{ invite: unknown }>(
    `/organizations/${organizationId}/members/invite`,
    jsonInit('POST', input),
  );
}

export async function patchMemberRoleRequest(
  organizationId: string,
  memberId: string,
  role: OrgRole,
): Promise<ApiEnvelope<{ membership: PublicOrganizationMember }>> {
  return apiJson<{ membership: PublicOrganizationMember }>(
    `/organizations/${organizationId}/members/${memberId}`,
    jsonInit('PATCH', { role }),
  );
}

export async function removeMemberRequest(
  organizationId: string,
  memberId: string,
): Promise<ApiEnvelope<{ membership: PublicOrganizationMember }>> {
  return apiJson<{ membership: PublicOrganizationMember }>(
    `/organizations/${organizationId}/members/${memberId}`,
    jsonInit('DELETE'),
  );
}
