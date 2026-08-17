import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthGate } from '@/features/auth/components/auth-gate';
import { resetAuthRuntimeForTests } from '@/features/auth/session-client';
import { useSessionStore } from '@/features/auth/session-store';
import { mockPathname, mockReplace } from '@/test/navigation-mock';

describe('AuthGate', () => {
  afterEach(() => {
    cleanup();
    resetAuthRuntimeForTests();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('shows loading while status is unknown and does not render app chrome', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {})),
    );
    useSessionStore.setState({ status: 'unknown', accessToken: null, user: null });
    mockPathname.mockReturnValue('/dashboard');
    render(
      <AuthGate>
        <div data-testid="secret">secret</div>
      </AuthGate>,
    );
    expect(screen.getByTestId('auth-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('secret')).not.toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('renders children when authenticated', () => {
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
    });
    render(
      <AuthGate>
        <div data-testid="secret">secret</div>
      </AuthGate>,
    );
    expect(screen.getByTestId('secret')).toBeInTheDocument();
  });

  it('redirects unauthenticated users to login with next', () => {
    mockReplace.mockClear();
    mockPathname.mockReturnValue('/settings/security');
    useSessionStore.setState({
      status: 'unauthenticated',
      accessToken: null,
      user: null,
    });
    render(
      <AuthGate>
        <div data-testid="secret">secret</div>
      </AuthGate>,
    );
    expect(screen.queryByTestId('secret')).not.toBeInTheDocument();
    expect(mockReplace).toHaveBeenCalledWith(
      `/login?next=${encodeURIComponent('/settings/security')}`,
    );
  });
});
