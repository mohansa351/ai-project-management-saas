import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import LoginPage from '@/app/(auth)/login/page';
import { Topbar } from '@/components/shell/topbar';
import { resetAuthRuntimeForTests } from '@/features/auth/session-client';
import { useSessionStore } from '@/features/auth/session-store';
import { mockReplace, mockSearchParams } from '@/test/navigation-mock';

const sessionUser = {
  id: 'user_1',
  email: 'ada@example.com',
  name: 'Ada',
  isActive: true,
  emailVerifiedAt: 't',
  systemRole: 'USER' as const,
  createdAt: 't',
  updatedAt: 't',
};

describe('login silent refresh and logout', () => {
  afterEach(() => {
    cleanup();
    resetAuthRuntimeForTests();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    mockSearchParams.mockReturnValue(new URLSearchParams());
  });

  it('bounces to a safe next path when silent refresh succeeds', async () => {
    mockSearchParams.mockReturnValue(new URLSearchParams('next=/settings/security'));
    mockReplace.mockClear();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            success: true,
            data: { accessToken: 'tok', user: sessionUser },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );

    render(<LoginPage />);
    expect(screen.getByTestId('login-checking')).toBeInTheDocument();

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/settings/security');
    });
  });

  it('rejects an open-redirect next even after silent refresh', async () => {
    mockSearchParams.mockReturnValue(
      new URLSearchParams('next=https://evil.example/phish'),
    );
    mockReplace.mockClear();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            success: true,
            data: { accessToken: 'tok', user: sessionUser },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );

    render(<LoginPage />);
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/dashboard');
    });
  });

  it('shows the login form when silent refresh fails', async () => {
    mockReplace.mockClear();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            success: false,
            error: { code: 'AUTH_UNAUTHORIZED', message: 'Authentication required.' },
          }),
          { status: 401, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );

    render(<LoginPage />);
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('routes unverified login to the verify-email page without storing a session', async () => {
    mockReplace.mockClear();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            success: false,
            error: {
              code: 'EMAIL_NOT_VERIFIED',
              message: 'Please verify your email before signing in.',
            },
          }),
          { status: 403, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );

    const user = userEvent.setup();
    render(<LoginPage />);
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Email'), 'ada@example.com');
    await user.type(screen.getByLabelText('Password'), 'password1');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/verify-email?email=ada%40example.com');
    });
    expect(useSessionStore.getState().status).not.toBe('authenticated');
    expect(useSessionStore.getState().accessToken).toBeNull();
  });

  it('logout posts to the logout endpoint and sends the user to /login', async () => {
    const user = userEvent.setup();
    mockReplace.mockClear();
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ success: true, data: { message: 'Logged out.' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    useSessionStore.setState({
      status: 'authenticated',
      accessToken: 'tok',
      user: sessionUser,
      currentOrganizationId: 'org_a',
    });

    render(<Topbar />);
    await user.click(screen.getByTestId('user-menu'));
    await user.click(screen.getByTestId('logout-button'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    const firstCall = fetchMock.mock.calls[0];
    expect(firstCall).toBeDefined();
    const [url, init] = firstCall as unknown as [string, RequestInit];
    expect(url).toBe('/api/v1/auth/logout');
    expect(init.credentials).toBe('include');
    expect(new Headers(init.headers).get('Authorization')).toBeNull();
    expect(mockReplace).toHaveBeenCalledWith('/login');
    expect(useSessionStore.getState().status).toBe('unauthenticated');
    expect(useSessionStore.getState().accessToken).toBeNull();
    expect(useSessionStore.getState().currentOrganizationId).toBeNull();
  });
});
