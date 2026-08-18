'use client';

import Link from 'next/link';

import { useSessionStore } from '@/features/auth/session-store';
import { isCurrentOrgAdmin } from '@/features/organizations/org-api';
import { useOrganizationsQuery } from '@/features/organizations/use-organizations-query';

export function SettingsHomePage() {
  const currentOrganizationId = useSessionStore((s) => s.currentOrganizationId);
  const organizationsQuery = useOrganizationsQuery();
  const showMembers = isCurrentOrgAdmin(organizationsQuery.data, currentOrganizationId);

  return (
    <div className="mx-auto max-w-[440px]">
      <h2 className="text-2xl font-semibold tracking-tight text-foreground">Settings</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Profile settings arrive in a later epic.
      </p>
      <ul className="mt-6 flex flex-col gap-2 text-sm">
        <li>
          <Link
            className="text-primary underline-offset-4 hover:underline"
            href="/settings/security"
          >
            Security
          </Link>
        </li>
        {showMembers ? (
          <li>
            <Link
              className="text-primary underline-offset-4 hover:underline"
              href="/settings/members"
              data-testid="settings-members-link"
            >
              Members
            </Link>
          </li>
        ) : null}
      </ul>
    </div>
  );
}
