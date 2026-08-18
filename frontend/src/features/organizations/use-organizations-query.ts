import { useQuery } from '@tanstack/react-query';

import { useSessionStore } from '@/features/auth/session-store';
import {
  listOrganizationsRequest,
  organizationsQueryKey,
} from '@/features/organizations/org-api';

export function useOrganizationsQuery() {
  const status = useSessionStore((s) => s.status);
  return useQuery({
    queryKey: organizationsQueryKey,
    queryFn: async () => {
      const envelope = await listOrganizationsRequest();
      if (!envelope.success) {
        throw new Error(envelope.error.message);
      }
      return envelope.data.organizations;
    },
    enabled: status === 'authenticated',
  });
}
