'use client';

import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { listOrganizationsRequest, type PublicOrganization } from '@/features/organizations/org-api';
import { useSessionStore } from '@/features/auth/session-store';
import { cn } from '@/lib/utils';

type OrgSwitcherProps = {
  /** Desktop rail: collapse label below lg. */
  responsive?: boolean;
  /** Mobile sheet: always show full label. */
  forceExpanded?: boolean;
  className?: string;
};

function initials(name: string): string {
  const letters = name.replace(/[^A-Za-z0-9]/g, '');
  return (letters.slice(0, 2) || '—').toUpperCase();
}

function currentName(organizations: PublicOrganization[] | undefined, id: string | null): string {
  return organizations?.find((org) => org.id === id)?.name ?? '';
}

export function OrgSwitcher({
  responsive = false,
  forceExpanded = false,
  className,
}: OrgSwitcherProps) {
  const collapsedChrome = responsive && !forceExpanded;
  const status = useSessionStore((s) => s.status);
  const currentOrganizationId = useSessionStore((s) => s.currentOrganizationId);
  const setCurrentOrganizationId = useSessionStore((s) => s.setCurrentOrganizationId);
  const queryClient = useQueryClient();
  const authenticated = status === 'authenticated';

  const query = useQuery({
    queryKey: ['organizations'],
    queryFn: async () => {
      const envelope = await listOrganizationsRequest();
      if (!envelope.success) {
        throw new Error(envelope.error.message);
      }
      return envelope.data.organizations;
    },
    enabled: authenticated,
  });

  const organizations = query.data;

  useEffect(() => {
    if (!organizations) {
      return;
    }
    const ids = new Set(organizations.map((org) => org.id));
    if (query.isFetching) {
      return;
    }
    if (currentOrganizationId && ids.has(currentOrganizationId)) {
      return;
    }
    const nextId = organizations[0]?.id ?? null;
    setCurrentOrganizationId(nextId);
    if (currentOrganizationId && currentOrganizationId !== nextId) {
      void queryClient.invalidateQueries({ queryKey: ['org'] });
    }
  }, [organizations, currentOrganizationId, setCurrentOrganizationId, queryClient, query.isFetching]);

  const selectedId = currentOrganizationId ?? '';
  const name = currentName(organizations, currentOrganizationId);
  const empty = !query.isError && (!organizations || organizations.length === 0);
  const disabled = !authenticated || query.isPending || empty || query.isError;

  return (
    <div
      className={cn(
        'flex w-full items-center gap-2 rounded-md border border-border bg-card px-3 text-left text-sm text-foreground',
        'min-h-11',
        collapsedChrome ? 'justify-center px-0 lg:justify-start lg:px-3' : 'justify-start',
        className,
      )}
    >
      <span
        className={cn(
          'text-xs font-semibold text-primary',
          collapsedChrome ? 'inline lg:hidden' : 'hidden',
        )}
        aria-hidden
      >
        {initials(name || 'Org')}
      </span>
      <label className="min-w-0 flex-1">
        <span className="sr-only">Current organization</span>
        <select
          data-testid="org-switcher"
          aria-label={name ? `Current organization: ${name}` : 'Current organization'}
          disabled={disabled}
          value={selectedId}
          onChange={(event) => {
            const nextId = event.target.value;
            setCurrentOrganizationId(nextId || null);
            void queryClient.invalidateQueries({ queryKey: ['org'] });
          }}
          className={cn(
            'w-full min-h-11 cursor-pointer truncate bg-transparent font-medium text-foreground focus-visible:outline-none disabled:cursor-default',
            collapsedChrome ? 'text-xs lg:text-sm' : 'text-sm',
          )}
        >
          {query.isError ? (
            <option value={selectedId}>Unable to load organizations</option>
          ) : null}
          {empty ? <option value="">No organization</option> : null}
          {organizations?.map((org) => (
            <option key={org.id} value={org.id}>
              {org.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
