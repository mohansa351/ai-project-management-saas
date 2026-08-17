import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import RegisterPage from '@/app/(auth)/register/page';
import { AuthCard } from '@/features/auth/components/auth-card';
import { resetAuthRuntimeForTests } from '@/features/auth/session-client';
import { mockReplace } from '@/test/navigation-mock';

describe('auth pages', () => {
  afterEach(() => {
    cleanup();
    resetAuthRuntimeForTests();
    vi.restoreAllMocks();
  });

  it('renders the product name on the auth card and never the app shell', () => {
    render(
      <AuthCard title="Sign in">
        <p>form</p>
      </AuthCard>,
    );
    expect(screen.getByTestId('auth-product-name')).toHaveTextContent(
      'AI Project Management SaaS',
    );
    expect(screen.queryByTestId('app-shell')).not.toBeInTheDocument();
  });

  it('register form disables submit while in-flight and does not store a session on 201', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            user: {
              id: '1',
              email: 'ada@example.com',
              name: 'Ada',
              isActive: true,
              emailVerifiedAt: null,
              systemRole: 'USER',
              createdAt: 't',
              updatedAt: 't',
            },
          },
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    mockReplace.mockClear();

    render(<RegisterPage />);
    await user.type(screen.getByLabelText('Name'), 'Ada');
    await user.type(screen.getByLabelText('Email'), 'ada@example.com');
    await user.type(screen.getByLabelText('Password'), 'password1');
    await user.type(screen.getByLabelText('Confirm password'), 'password1');
    await user.click(screen.getByRole('button', { name: 'Register' }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/auth/register');
    expect(init.credentials).toBe('include');
    expect(new Headers(init.headers).get('Authorization')).toBeNull();
    expect(mockReplace).toHaveBeenCalledWith('/verify-email?email=ada%40example.com');
  });
});
