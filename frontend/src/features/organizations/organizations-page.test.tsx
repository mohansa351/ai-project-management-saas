import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OrganizationsPage } from '@/features/organizations/organizations-page';
import { orgQueryKey, type PublicOrganization } from '@/features/organizations/org-api';
import { resetAuthRuntimeForTests } from '@/features/auth/session-client';
import { useSessionStore } from '@/features/auth/session-store';

const orgs: PublicOrganization[] = [
  {
    id: 'org_a',
    name: 'Acme Technologies',
    slug: 'acme',
    createdAt: 't',
    updatedAt: 't',
    deletedAt: null,
    membership: { role: 'ORG_ADMIN', status: 'ACTIVE' },
  },
  {
    id: 'org_b',
    name: 'Beta Labs',
    slug: 'beta',
    createdAt: 't',
    updatedAt: 't',
    deletedAt: null,
    membership: { role: 'TEAM_MEMBER', status: 'ACTIVE' },
  },
];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function renderPage(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <OrganizationsPage />
      </QueryClientProvider>,
    ),
  };
}

describe('Organizations page', () => {
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
      currentOrganizationId: 'org_a',
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

  it('lists memberships as cards, marks the current org, and selects via the store', async () => {
    const user = userEvent.setup();
    const { client } = renderPage();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    client.setQueryData(orgQueryKey('org_a', 'metrics'), { n: 1 });

    expect(await screen.findByTestId('org-card-org_a')).toHaveTextContent('Current organization');
    expect(screen.getByTestId('org-card-org_b')).toHaveTextContent('Beta Labs');

    await user.click(screen.getByRole('button', { name: 'Select' }));
    expect(useSessionStore.getState().currentOrganizationId).toBe('org_b');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['org'] });
  });

  it('creates an organization, refreshes the list, and makes it current', async () => {
    const user = userEvent.setup();
    const created: PublicOrganization = {
      id: 'org_c',
      name: 'Cedar',
      slug: 'cedar',
      createdAt: 't',
      updatedAt: 't',
      deletedAt: null,
      membership: { role: 'ORG_ADMIN', status: 'ACTIVE' },
    };
    const fetchMock = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      if (String(input) === '/api/v1/organizations' && init?.method === 'POST') {
        return jsonResponse({ success: true, data: { organization: created } }, 201);
      }
      const listed = useSessionStore.getState().currentOrganizationId === 'org_c' ? [...orgs, created] : orgs;
      return jsonResponse({
        success: true,
        data: { organizations: listed },
        meta: { page: 1, pageSize: 100, total: listed.length, totalPages: 1 },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { client } = renderPage();
    const invalidate = vi.spyOn(client, 'invalidateQueries');

    await screen.findByTestId('org-card-org_a');
    await user.type(screen.getByLabelText('Name'), 'Cedar');
    await user.type(screen.getByLabelText('Slug (optional)'), 'cedar');
    await user.click(screen.getByRole('button', { name: 'Create organization' }));

    await waitFor(() => {
      expect(useSessionStore.getState().currentOrganizationId).toBe('org_c');
    });
    expect(await screen.findByTestId('create-organization-success')).toHaveTextContent(
      'Organization created.',
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['organizations'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['org'] });
  });

  it('shows field and envelope errors when create fails', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo, init?: RequestInit) => {
        if (String(input) === '/api/v1/organizations' && init?.method === 'POST') {
          return jsonResponse({
            success: false,
            error: {
              code: 'VALIDATION_ERROR',
              message: 'This slug is already taken.',
              details: { slug: ['This slug is already taken'] },
            },
          });
        }
        return jsonResponse({
          success: true,
          data: { organizations: orgs },
          meta: { page: 1, pageSize: 100, total: 2, totalPages: 1 },
        });
      }),
    );
    renderPage();
    await screen.findByTestId('org-card-org_a');
    await user.type(screen.getByLabelText('Name'), 'Acme');
    await user.type(screen.getByLabelText('Slug (optional)'), 'acme');
    await user.click(screen.getByRole('button', { name: 'Create organization' }));
    expect(await screen.findByTestId('auth-form-error')).toHaveTextContent('This slug is already taken.');
    expect(screen.getByText('This slug is already taken')).toBeInTheDocument();
  });

  it('shows loading, empty-with-create, and error-with-retry states', async () => {
    let resolveList: ((value: Response) => void) | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveList = resolve;
          }),
      ),
    );
    renderPage();
    expect(screen.getByRole('status')).toHaveTextContent('Loading organizations.');
    expect(screen.queryByTestId('create-organization-form')).not.toBeInTheDocument();
    resolveList?.(
      jsonResponse({
        success: true,
        data: { organizations: [] },
        meta: { page: 1, pageSize: 100, total: 0, totalPages: 0 },
      }),
    );
    expect(await screen.findByText(/You do not belong to an organization yet/)).toBeInTheDocument();
    expect(screen.getByTestId('create-organization-form')).toBeInTheDocument();
  });

  it('retries a failed organization list fetch', async () => {
    const user = userEvent.setup();
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls += 1;
        if (calls === 1) {
          return jsonResponse({ success: false, error: { code: 'INTERNAL_ERROR', message: 'fail' } });
        }
        return jsonResponse({
          success: true,
          data: { organizations: orgs },
          meta: { page: 1, pageSize: 100, total: 2, totalPages: 1 },
        });
      }),
    );
    useSessionStore.setState({ status: 'authenticated', accessToken: 'tok' });
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load organizations.');
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByTestId('org-card-org_a')).toBeInTheDocument();
  });
});
