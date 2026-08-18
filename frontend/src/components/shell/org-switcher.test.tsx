import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OrgSwitcher } from '@/components/shell/org-switcher';
import { orgQueryKey } from '@/features/organizations/org-api';
import { resetAuthRuntimeForTests } from '@/features/auth/session-client';
import { useSessionStore } from '@/features/auth/session-store';

const orgs = [
  {
    id: 'org_a',
    name: 'Acme Technologies',
    slug: 'acme',
    createdAt: 't',
    updatedAt: 't',
    deletedAt: null,
  },
  {
    id: 'org_b',
    name: 'Beta Labs',
    slug: 'beta',
    createdAt: 't',
    updatedAt: 't',
    deletedAt: null,
  },
];

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function renderSwitcher(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <OrgSwitcher />
      </QueryClientProvider>,
    ),
  };
}

describe('OrgSwitcher', () => {
  beforeEach(() => {
    resetAuthRuntimeForTests();
    useSessionStore.setState({
      status: 'authenticated',
      accessToken: 'tok',
      user: {
        id: '1',
        email: 'ada@example.com',
        name: 'Ada',
        isActive: true,
        emailVerifiedAt: 't',
        systemRole: 'USER',
        createdAt: 't',
        updatedAt: 't',
      },
      currentOrganizationId: null,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          success: true,
          data: { organizations: orgs },
          meta: { page: 1, pageSize: 100, total: 2, totalPages: 1 },
        }),
      ),
    );
  });

  afterEach(() => {
    cleanup();
    resetAuthRuntimeForTests();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('lists memberships, defaults to the first org, and shows the current name', async () => {
    renderSwitcher();
    const switcher = await screen.findByTestId('org-switcher');
    await waitFor(() => {
      expect(switcher).toHaveValue('org_a');
    });
    expect(switcher).toHaveAccessibleName(/Acme Technologies/);
    expect(useSessionStore.getState().currentOrganizationId).toBe('org_a');
    expect(switcher).not.toBeDisabled();
  });

  it('updates currentOrganizationId and invalidates org-scoped queries on change', async () => {
    const user = userEvent.setup();
    const { client } = renderSwitcher();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    client.setQueryData(orgQueryKey('org_a', 'metrics'), { n: 1 });

    const switcher = await screen.findByTestId('org-switcher');
    await waitFor(() => expect(switcher).toHaveValue('org_a'));
    await user.selectOptions(switcher, 'org_b');

    expect(useSessionStore.getState().currentOrganizationId).toBe('org_b');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['org'] });
  });

  it('replaces a stale selection with the first live membership', async () => {
    useSessionStore.setState({ currentOrganizationId: 'org_gone' });
    renderSwitcher();
    const switcher = await screen.findByTestId('org-switcher');
    await waitFor(() => {
      expect(switcher).toHaveValue('org_a');
    });
    expect(useSessionStore.getState().currentOrganizationId).toBe('org_a');
  });

  it('shows an empty disabled switcher when the user has no memberships', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          success: true,
          data: { organizations: [] },
          meta: { page: 1, pageSize: 100, total: 0, totalPages: 0 },
        }),
      ),
    );

    renderSwitcher();
    const switcher = await screen.findByTestId('org-switcher');
    await waitFor(() => {
      expect(switcher).toHaveTextContent('No organization');
    });
    expect(switcher).toBeDisabled();
    expect(useSessionStore.getState().currentOrganizationId).toBeNull();
  });
});
