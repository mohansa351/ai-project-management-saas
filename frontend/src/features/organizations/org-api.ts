import { apiJson, type ApiEnvelope } from '@/lib/api/client';

export type PublicOrganization = {
  id: string;
  name: string;
  slug: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export function orgQueryKey(organizationId: string, ...parts: string[]): readonly unknown[] {
  return ['org', organizationId, ...parts];
}

export async function listOrganizationsRequest(): Promise<
  ApiEnvelope<{ organizations: PublicOrganization[] }>
> {
  return apiJson<{ organizations: PublicOrganization[] }>('/organizations?page=1&pageSize=100');
}
