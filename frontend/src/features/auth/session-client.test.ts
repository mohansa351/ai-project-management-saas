import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { changePasswordRequest, resetPasswordRequest } from '@/features/auth/auth-api';
import { resetAuthRuntimeForTests } from '@/features/auth/session-client';
import { useSessionStore } from '@/features/auth/session-store';
import type { PublicUser } from '@/features/auth/types';
import { apiFetch } from '@/lib/api/client';

const here = path.dirname(fileURLToPath(import.meta.url));

const sessionUser: PublicUser = {
  id: 'user_1',
  email: 'ada@example.com',
  name: 'Ada',
  isActive: true,
  emailVerifiedAt: '2026-01-01T00:00:00.000Z',
  systemRole: 'USER',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function unsignedJwt(expOffsetSeconds: number): string {
  const exp = Math.floor(Date.now() / 1000) + expOffsetSeconds;
  const payload = Buffer.from(JSON.stringify({ exp, sub: 'user_1' })).toString(
    'base64url',
  );
  return `eyJhbGciOiJub25lIn0.${payload}.sig`;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function unauthorized() {
  return jsonResponse(401, {
    success: false,
    error: { code: 'AUTH_UNAUTHORIZED', message: 'Authentication required.' },
  });
}

function rotated() {
  return jsonResponse(200, {
    success: true,
    data: { accessToken: 'access-new', user: sessionUser },
  });
}

describe('session client', () => {
  beforeEach(() => {
    resetAuthRuntimeForTests();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetAuthRuntimeForTests();
  });

  it('forces credentials include and omits Bearer on refresh', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async () => rotated());

    const { refreshSession } = await import('@/features/auth/session-client');
    await refreshSession();

    expect(fetchMock).toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/auth/refresh');
    expect(init.credentials).toBe('include');
    expect(new Headers(init.headers).get('Authorization')).toBeNull();
    expect(init.body).toBeUndefined();
  });

  it('single-flights five concurrent protected 401s into one refresh', async () => {
    const fetchMock = vi.mocked(fetch);
    let refreshCalls = 0;
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/auth/refresh')) {
        refreshCalls += 1;
        return rotated();
      }
      const auth = new Headers(init?.headers).get('Authorization');
      if (auth === 'Bearer access-new') {
        return jsonResponse(200, { success: true, data: { user: sessionUser } });
      }
      return unauthorized();
    });

    useSessionStore.setState({ accessToken: 'stale', status: 'authenticated' });

    await Promise.all([
      apiFetch('/auth/me'),
      apiFetch('/auth/me'),
      apiFetch('/auth/me'),
      apiFetch('/auth/me'),
      apiFetch('/auth/me'),
    ]);

    expect(refreshCalls).toBe(1);
    expect(useSessionStore.getState().accessToken).toBe('access-new');
    expect(useSessionStore.getState().status).toBe('authenticated');
  });

  it('retries refresh exactly once after overlap 401 then succeeds', async () => {
    const fetchMock = vi.mocked(fetch);
    let refreshCalls = 0;
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/auth/refresh')) {
        refreshCalls += 1;
        if (refreshCalls === 1) {
          return unauthorized();
        }
        return rotated();
      }
      return unauthorized();
    });

    useSessionStore.setState({ accessToken: 'stale', status: 'authenticated' });
    await apiFetch('/auth/me');

    expect(refreshCalls).toBe(2);
    expect(useSessionStore.getState().accessToken).toBe('access-new');
  });

  it('stops after one overlap retry when refresh keeps 401 and does not POST logout', async () => {
    const fetchMock = vi.mocked(fetch);
    const urls: string[] = [];
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      urls.push(url);
      return unauthorized();
    });

    useSessionStore.setState({ accessToken: 'stale', status: 'authenticated' });
    const res = await apiFetch('/auth/me');

    expect(res.status).toBe(401);
    expect(urls.filter((u) => u.endsWith('/auth/refresh'))).toHaveLength(2);
    expect(urls.filter((u) => u.endsWith('/auth/logout'))).toHaveLength(0);
    expect(urls.filter((u) => u.endsWith('/auth/refresh')).length).toBe(2);
    expect(useSessionStore.getState().status).toBe('unauthenticated');
    expect(useSessionStore.getState().accessToken).toBeNull();
  });

  it('rebuilds Authorization from the store on retry, not the stale header', async () => {
    const fetchMock = vi.mocked(fetch);
    const auths: Array<string | null> = [];
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      const auth = new Headers(init?.headers).get('Authorization');
      if (!url.endsWith('/auth/refresh')) {
        auths.push(auth);
      }
      if (url.endsWith('/auth/refresh')) {
        return rotated();
      }
      if (auth === 'Bearer access-new') {
        return jsonResponse(200, { success: true, data: { user: sessionUser } });
      }
      return unauthorized();
    });

    useSessionStore.setState({ accessToken: 'stale', status: 'authenticated' });
    await apiFetch('/auth/me', { headers: { Authorization: 'Bearer captured-stale' } });

    expect(auths[0]).toBe('Bearer stale');
    expect(auths.at(-1)).toBe('Bearer access-new');
    expect(auths).not.toContain('Bearer captured-stale');
  });

  it('does not recover login 401 via refresh', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async () =>
      jsonResponse(401, {
        success: false,
        error: { code: 'AUTH_UNAUTHORIZED', message: 'Invalid email or password.' },
      }),
    );

    await apiFetch(
      '/auth/login',
      {
        method: 'POST',
        body: JSON.stringify({ email: 'a@b.c', password: 'password1' }),
      },
      { skipAuth: true, recoverSession: 'never' },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('/api/v1/auth/login');
  });

  it('treats change-password 401 with a still-fresh JWT as a form error without refresh or logout', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async () => unauthorized());
    useSessionStore.setState({
      accessToken: unsignedJwt(600),
      status: 'authenticated',
      user: sessionUser,
    });

    const envelope = await changePasswordRequest({
      currentPassword: 'wrongpass',
      newPassword: 'newpass12',
    });

    expect(envelope.success).toBe(false);
    if (!envelope.success) {
      expect(envelope.error.message).toBe('Current password is incorrect.');
    }
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toEqual([
      '/api/v1/auth/change-password',
    ]);
    expect(useSessionStore.getState().status).toBe('authenticated');
  });

  it('refreshes when change-password 401 arrives with an expired JWT, then remaps a still-wrong current password', async () => {
    const fetchMock = vi.mocked(fetch);
    const refreshedToken = unsignedJwt(600);
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/auth/refresh')) {
        return jsonResponse(200, {
          success: true,
          data: { accessToken: refreshedToken, user: sessionUser },
        });
      }
      return unauthorized();
    });
    useSessionStore.setState({
      accessToken: unsignedJwt(-30),
      status: 'authenticated',
      user: sessionUser,
    });

    const envelope = await changePasswordRequest({
      currentPassword: 'wrongpass',
      newPassword: 'newpass12',
    });

    expect(envelope.success).toBe(false);
    if (!envelope.success) {
      expect(envelope.error.message).toBe('Current password is incorrect.');
    }
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toEqual([
      '/api/v1/auth/change-password',
      '/api/v1/auth/refresh',
      '/api/v1/auth/change-password',
    ]);
    expect(useSessionStore.getState().status).toBe('authenticated');
    expect(useSessionStore.getState().accessToken).toBe(refreshedToken);
  });

  it('applies the reissued session after a successful change-password', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, {
        success: true,
        data: { accessToken: 'access-after-change', user: sessionUser },
      }),
    );
    useSessionStore.setState({
      accessToken: unsignedJwt(600),
      status: 'authenticated',
      user: sessionUser,
    });

    const envelope = await changePasswordRequest({
      currentPassword: 'oldpass12',
      newPassword: 'newpass12',
    });

    expect(envelope.success).toBe(true);
    expect(useSessionStore.getState().accessToken).toBe('access-after-change');
    expect(useSessionStore.getState().status).toBe('authenticated');
  });

  it('clears the in-memory session after reset-password without posting logout', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, {
        success: true,
        data: { message: 'Password reset.' },
      }),
    );
    useSessionStore.setState({
      accessToken: 'stale',
      status: 'authenticated',
      user: sessionUser,
    });

    const envelope = await resetPasswordRequest('reset-token', 'newpass12');

    expect(envelope.success).toBe(true);
    expect(useSessionStore.getState().status).toBe('unauthenticated');
    expect(useSessionStore.getState().accessToken).toBeNull();
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toEqual([
      '/api/v1/auth/reset-password',
    ]);
  });

  it('does not persist the access token or mention document.cookie / persist middleware', () => {
    const storeSrc = readFileSync(path.join(here, 'session-store.ts'), 'utf8');
    const clientSrc = readFileSync(path.join(here, 'session-client.ts'), 'utf8');
    const apiSrc = readFileSync(path.join(here, 'auth-api.ts'), 'utf8');
    expect(storeSrc).not.toMatch(/\bpersist\b/);
    expect(storeSrc).not.toMatch(/localStorage|sessionStorage/);
    expect(storeSrc).not.toMatch(/refresh_token/);
    expect(clientSrc).not.toMatch(/document\.cookie/);
    expect(clientSrc).not.toMatch(/localStorage|sessionStorage/);
    expect(clientSrc).not.toMatch(/BroadcastChannel/);
    expect(apiSrc).not.toMatch(/localStorage|sessionStorage|document\.cookie/);
  });
});
