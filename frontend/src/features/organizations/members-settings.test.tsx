import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Topbar } from '@/components/shell/topbar';
import { resetAuthRuntimeForTests } from '@/features/auth/session-client';
import { useSessionStore } from '@/features/auth/session-store';
import { MembersSettingsPage } from '@/features/organizations/members-settings-page';
import { SettingsHomePage } from '@/features/organizations/settings-home-page';
import type { PublicOrganization, PublicOrganizationMember } from '@/features/organizations/org-api';

const adminOrg: PublicOrganization = {
  id: 'org_a',
  name: 'Acme',
  slug: 'acme',
  createdAt: 't',
  updatedAt: 't',
  deletedAt: null,
  membership: { role: 'ORG_ADMIN', status: 'ACTIVE' },
};

const tmOrg: PublicOrganization = {
  ...adminOrg,
  membership: { role: 'TEAM_MEMBER', status: 'ACTIVE' },
};

const members: PublicOrganizationMember[] = [
  {
    id: 'mem_admin',
    organizationId: 'org_a',
    userId: 'user_1',
    role: 'ORG_ADMIN',
    status: 'ACTIVE',
    createdAt: 't',
    updatedAt: 't',
    user: { id: 'user_1', email: 'ada@example.com', name: 'Ada' },
  },
  {
    id: 'mem_pending',
    organizationId: 'org_a',
    userId: 'user_2',
    role: 'TEAM_MEMBER',
    status: 'PENDING',
    createdAt: 't',
    updatedAt: 't',
    user: { id: 'user_2', email: 'pat@example.com', name: 'Pat' },
  },
];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function sessionUser() {
  return {
    id: 'user_1',
    email: 'ada@example.com',
    name: 'Ada',
    isActive: true,
    emailVerifiedAt: 't',
    systemRole: 'USER' as const,
    createdAt: 't',
    updatedAt: 't',
  };
}

function authenticate(currentOrganizationId: string | null) {
  resetAuthRuntimeForTests();
  useSessionStore.setState({
    status: 'authenticated',
    accessToken: 'tok',
    user: sessionUser(),
    currentOrganizationId,
  });
}

function renderMembers(
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) {
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <MembersSettingsPage />
      </QueryClientProvider>,
    ),
  };
}

describe('Members settings', () => {
  beforeEach(() => {
    authenticate('org_a');
  });

  afterEach(() => {
    cleanup();
    resetAuthRuntimeForTests();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function mockAdminRoster(handlers?: {
    postInvite?: () => Response;
    patchPending?: () => Response;
    deletePending?: () => Response;
    roster?: () => PublicOrganizationMember[];
  }) {
    return vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.startsWith('/api/v1/organizations?')) {
        return jsonResponse({
          success: true,
          data: { organizations: [adminOrg] },
          meta: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
        });
      }
      if (url.includes('/members/invite') && method === 'POST') {
        return handlers?.postInvite?.() ?? jsonResponse({ success: true, data: { invite: { id: 'inv_1' } } }, 201);
      }
      if (url.includes('/members/mem_pending') && method === 'PATCH') {
        return (
          handlers?.patchPending?.() ??
          jsonResponse({ success: true, data: { membership: { ...members[1], role: 'PROJECT_MANAGER' } } })
        );
      }
      if (url.includes('/members/mem_pending') && method === 'DELETE') {
        return handlers?.deletePending?.() ?? jsonResponse({ success: true, data: { membership: members[1] } });
      }
      const roster = handlers?.roster?.() ?? members;
      if (url.includes('/members?')) {
        return jsonResponse({
          success: true,
          data: { members: roster },
          meta: { page: 1, pageSize: 100, total: roster.length, totalPages: 1 },
        });
      }
      return jsonResponse({ success: false, error: { code: 'NOT_FOUND', message: url } }, 404);
    });
  }

  it('lists ACTIVE and PENDING members for the current organization only', async () => {
    const fetchMock = mockAdminRoster();
    vi.stubGlobal('fetch', fetchMock);
    renderMembers();
    expect(await screen.findByTestId('member-row-mem_admin')).toHaveTextContent('Ada');
    expect(screen.getByTestId('member-row-mem_pending')).toHaveTextContent('PENDING');
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/organizations/org_a/members'))).toBe(
      true,
    );
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('org_b'))).toBe(false);
    const membersCall = fetchMock.mock.calls.find(([url]) =>
      String(url).includes('/organizations/org_a/members'),
    );
    expect(new Headers((membersCall?.[1] as RequestInit | undefined)?.headers).get('X-Organization-Id')).toBe(
      'org_a',
    );
  });

  it('sends an invite for the current organization', async () => {
    const user = userEvent.setup();
    const fetchMock = mockAdminRoster();
    vi.stubGlobal('fetch', fetchMock);
    renderMembers();
    await screen.findByTestId('member-row-mem_admin');
    await user.click(screen.getByRole('button', { name: 'Invite member' }));
    await user.type(screen.getByLabelText('Email'), 'new@example.com');
    await user.click(screen.getByRole('button', { name: 'Send invite' }));
    expect(await screen.findByTestId('members-success')).toHaveTextContent('Invite sent.');
    const inviteCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/members/invite'));
    expect(inviteCall?.[1]).toEqual(
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ email: 'new@example.com', role: 'TEAM_MEMBER' }),
      }),
    );
  });

  it('updates a member role from the roster', async () => {
    const user = userEvent.setup();
    let roster = [...members];
    const fetchMock = mockAdminRoster({
      patchPending: () => {
        roster = roster.map((member) =>
          member.id === 'mem_pending' ? { ...member, role: 'PROJECT_MANAGER' } : member,
        );
        return jsonResponse({ success: true, data: { membership: roster[1] } });
      },
      roster: () => roster,
    });
    vi.stubGlobal('fetch', fetchMock);
    renderMembers();
    await screen.findByTestId('member-row-mem_pending');
    await user.selectOptions(screen.getByLabelText('Role for Pat'), 'PROJECT_MANAGER');
    await waitFor(() => {
      expect(screen.getByLabelText('Role for Pat')).toHaveValue('PROJECT_MANAGER');
    });
  });

  it('removes a member after confirmation', async () => {
    const user = userEvent.setup();
    let roster = [...members];
    const fetchMock = mockAdminRoster({
      deletePending: () => {
        roster = roster.filter((member) => member.id !== 'mem_pending');
        return jsonResponse({ success: true, data: { membership: members[1] } });
      },
      roster: () => roster,
    });
    vi.stubGlobal('fetch', fetchMock);
    renderMembers();
    await screen.findByTestId('member-row-mem_pending');
    await user.click(
      within(screen.getByTestId('member-row-mem_pending')).getByRole('button', { name: 'Remove' }),
    );
    expect(screen.getByRole('heading', { name: 'Remove member' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove member' }));
    await waitFor(() => {
      expect(screen.queryByTestId('member-row-mem_pending')).not.toBeInTheDocument();
    });
  });

  it('does not call DELETE when remove is cancelled', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: RequestInfo) => {
      const url = String(input);
      if (url.startsWith('/api/v1/organizations?')) {
        return jsonResponse({
          success: true,
          data: { organizations: [adminOrg] },
          meta: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
        });
      }
      return jsonResponse({
        success: true,
        data: { members },
        meta: { page: 1, pageSize: 100, total: 2, totalPages: 1 },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderMembers();
    await screen.findByTestId('member-row-mem_pending');
    await user.click(
      within(screen.getByTestId('member-row-mem_pending')).getByRole('button', { name: 'Remove' }),
    );
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(
      (fetchMock.mock.calls as Array<[RequestInfo, RequestInit?]>).some(
        (call) => call[1]?.method === 'DELETE',
      ),
    ).toBe(false);
  });

  it('shows last-admin API messages on role update and remove', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.startsWith('/api/v1/organizations?')) {
        return jsonResponse({
          success: true,
          data: { organizations: [adminOrg] },
          meta: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
        });
      }
      if (method === 'PATCH' || method === 'DELETE') {
        return jsonResponse({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Cannot demote or remove the last active organization admin.',
          },
        });
      }
      return jsonResponse({
        success: true,
        data: { members },
        meta: { page: 1, pageSize: 100, total: 2, totalPages: 1 },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderMembers();
    await screen.findByTestId('member-row-mem_admin');
    await user.selectOptions(screen.getByLabelText('Role for Ada'), 'TEAM_MEMBER');
    expect(await screen.findByTestId('auth-form-error')).toHaveTextContent(
      'Cannot demote or remove the last active organization admin.',
    );

    await user.click(
      within(screen.getByTestId('member-row-mem_admin')).getByRole('button', { name: 'Remove' }),
    );
    await user.click(screen.getByRole('button', { name: 'Remove member' }));
    expect(await screen.findByTestId('auth-form-error')).toHaveTextContent(
      'Cannot demote or remove the last active organization admin.',
    );
  });

  it('shows already-active and validation errors inline on invite', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo, init?: RequestInit) => {
        const url = String(input);
        if (url.startsWith('/api/v1/organizations?')) {
          return jsonResponse({
            success: true,
            data: { organizations: [adminOrg] },
            meta: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
          });
        }
        if (init?.method === 'POST') {
          return jsonResponse({
            success: false,
            error: {
              code: 'VALIDATION_ERROR',
              message: 'This user is already an active member of the organization.',
              details: { email: ['This user is already an active member of the organization'] },
            },
          });
        }
        return jsonResponse({
          success: true,
          data: { members },
          meta: { page: 1, pageSize: 100, total: 2, totalPages: 1 },
        });
      }),
    );
    renderMembers();
    await screen.findByTestId('member-row-mem_admin');
    await user.click(screen.getByRole('button', { name: 'Invite member' }));
    await user.type(screen.getByLabelText('Email'), 'ada@example.com');
    await user.click(screen.getByRole('button', { name: 'Send invite' }));
    expect(await screen.findByTestId('auth-form-error')).toHaveTextContent(
      'This user is already an active member of the organization.',
    );
    expect(
      screen.getByText('This user is already an active member of the organization'),
    ).toBeInTheDocument();
  });

  it('shows a 403 page and hides admin actions for non-admins without fetching the roster', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo) => {
      const url = String(input);
      if (url.startsWith('/api/v1/organizations?')) {
        return jsonResponse({
          success: true,
          data: { organizations: [tmOrg] },
          meta: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
        });
      }
      return jsonResponse({ success: false, error: { code: 'AUTHZ_FORBIDDEN', message: 'no' } }, 403);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderMembers();
    expect(await screen.findByTestId('members-forbidden')).toHaveTextContent('Forbidden');
    expect(screen.queryByRole('button', { name: 'Invite member' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/members'))).toBe(false);
  });

  it('shows a 403 page for PROJECT_MANAGER without fetching the roster or Members links', async () => {
    const user = userEvent.setup();
    const pmOrg: PublicOrganization = {
      ...adminOrg,
      membership: { role: 'PROJECT_MANAGER', status: 'ACTIVE' },
    };
    const fetchMock = vi.fn(async (input: RequestInfo) => {
      const url = String(input);
      if (url.startsWith('/api/v1/organizations?')) {
        return jsonResponse({
          success: true,
          data: { organizations: [pmOrg] },
          meta: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
        });
      }
      return jsonResponse({ success: false, error: { code: 'AUTHZ_FORBIDDEN', message: 'no' } }, 403);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <Topbar />
        <MembersSettingsPage />
        <SettingsHomePage />
      </QueryClientProvider>,
    );
    expect(await screen.findByTestId('members-forbidden')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/members'))).toBe(false);
    await user.click(screen.getByTestId('user-menu'));
    expect(screen.queryByTestId('user-menu-members')).not.toBeInTheDocument();
    expect(screen.queryByTestId('settings-members-link')).not.toBeInTheDocument();
  });

  it('hides the Members menu for non-admins and shows it for Org Admins', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        success: true,
        data: { organizations: [tmOrg] },
        meta: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <Topbar />
        <SettingsHomePage />
      </QueryClientProvider>,
    );
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    await user.click(screen.getByTestId('user-menu'));
    expect(screen.queryByTestId('user-menu-members')).not.toBeInTheDocument();
    expect(screen.queryByTestId('settings-members-link')).not.toBeInTheDocument();
    cleanup();

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          success: true,
          data: { organizations: [adminOrg] },
          meta: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
        }),
      ),
    );
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <Topbar />
        <SettingsHomePage />
      </QueryClientProvider>,
    );
    await user.click(screen.getByTestId('user-menu'));
    expect(await screen.findByTestId('user-menu-members')).toHaveTextContent('Members');
    expect(await screen.findByTestId('settings-members-link')).toBeInTheDocument();
  });

  it('points to Organizations when there is no current org', async () => {
    authenticate(null);
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
    renderMembers();
    expect(await screen.findByText(/Select an organization before managing members/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to Organizations' })).toHaveAttribute(
      'href',
      '/organizations',
    );
    expect(screen.queryByRole('button', { name: 'Invite member' })).not.toBeInTheDocument();
  });

  it('shows members loading, empty, and error-with-retry', async () => {
    let resolveMembers: ((value: Response) => void) | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo) => {
        const url = String(input);
        if (url.startsWith('/api/v1/organizations?')) {
          return jsonResponse({
            success: true,
            data: { organizations: [adminOrg] },
            meta: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
          });
        }
        return new Promise<Response>((resolve) => {
          resolveMembers = resolve;
        });
      }),
    );
    renderMembers();
    await waitFor(() => {
      expect(resolveMembers).toBeDefined();
    });
    expect(screen.getByRole('status')).toHaveTextContent('Loading members.');
    resolveMembers?.(
      jsonResponse({
        success: true,
        data: { members: [] },
        meta: { page: 1, pageSize: 100, total: 0, totalPages: 0 },
      }),
    );
    expect(await screen.findByText(/This organization has no members to show yet/)).toBeInTheDocument();
  });

  it('retries a failed members roster fetch', async () => {
    const user = userEvent.setup();
    let membersCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo) => {
        const url = String(input);
        if (url.startsWith('/api/v1/organizations?')) {
          return jsonResponse({
            success: true,
            data: { organizations: [adminOrg] },
            meta: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
          });
        }
        membersCalls += 1;
        if (membersCalls === 1) {
          return jsonResponse({ success: false, error: { code: 'INTERNAL_ERROR', message: 'fail' } });
        }
        return jsonResponse({
          success: true,
          data: { members },
          meta: { page: 1, pageSize: 100, total: 2, totalPages: 1 },
        });
      }),
    );
    renderMembers();
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load members.');
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByTestId('member-row-mem_admin')).toBeInTheDocument();
  });

  it('points to Organizations when the stored org is not in the membership list', async () => {
    authenticate('org_missing');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          success: true,
          data: { organizations: [adminOrg] },
          meta: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
        }),
      ),
    );
    renderMembers();
    expect(await screen.findByText(/Select an organization before managing members/)).toBeInTheDocument();
    expect(screen.queryByTestId('members-forbidden')).not.toBeInTheDocument();
  });
});
