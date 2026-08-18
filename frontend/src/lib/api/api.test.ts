import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NextConfig } from 'next';
import { PHASE_PRODUCTION_BUILD, PHASE_PRODUCTION_SERVER } from 'next/constants';

import {
  apiFetch,
  apiJson,
  configureApiFetchAuth,
  getApiBasePath,
  resolveApiPath,
} from '@/lib/api/client';

const configPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../next.config.ts',
);

function loadConfig(mod: { default: unknown }, phase?: string): NextConfig {
  const loaded = mod.default;
  if (typeof loaded !== 'function') {
    throw new Error('expected next.config default export to be a phase function');
  }
  return (loaded as (phase?: string) => NextConfig)(phase);
}

describe('API rewrite matrix', () => {
  afterEach(() => {
    configureApiFetchAuth(null);
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('browser helper uses relative /api/v1 only (no absolute API host)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    expect(getApiBasePath()).toBe('/api/v1');

    await apiFetch('/health');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit?];
    expect(url).toBe('/api/v1/health');
    expect(url.startsWith('/api/v1')).toBe(true);
    expect(url).not.toMatch(/^https?:\/\//);
    expect(url).not.toContain('localhost:4000');
    expect(url).not.toContain('NEXT_PUBLIC');
    expect(init?.credentials).toBe('include');
  });

  it('forces credentials include even if the caller passes omit', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await apiFetch('/health', { credentials: 'omit' });

    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(requestInit.credentials).toBe('include');
  });

  it('does not double /api/v1 when caller already includes the prefix', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await apiFetch('/api/v1/health');

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit?];
    expect(url).toBe('/api/v1/health');
  });

  it('attaches X-Organization-Id with Bearer when an organization id is set', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    configureApiFetchAuth({
      getAccessToken: () => 'access-token',
      getOrganizationId: () => 'org_a',
      shouldAttachBearer: () => true,
      recoverUnauthorized: async () => null,
    });

    await apiFetch('/organizations/org_a/members');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get('Authorization')).toBe('Bearer access-token');
    expect(headers.get('X-Organization-Id')).toBe('org_a');
  });

  it('does not send X-Organization-Id on skipAuth fetches', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    configureApiFetchAuth({
      getAccessToken: () => 'access-token',
      getOrganizationId: () => 'org_a',
      shouldAttachBearer: () => true,
      recoverUnauthorized: async () => null,
    });

    await apiFetch('/auth/login', { method: 'POST' }, { skipAuth: true });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get('Authorization')).toBeNull();
    expect(headers.get('X-Organization-Id')).toBeNull();
  });

  it('drops a caller-supplied X-Organization-Id when the store has no org id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    configureApiFetchAuth({
      getAccessToken: () => 'access-token',
      getOrganizationId: () => null,
      shouldAttachBearer: () => true,
      recoverUnauthorized: async () => null,
    });

    await apiFetch('/organizations/org_a', {
      headers: { 'X-Organization-Id': 'org_spoof' },
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get('X-Organization-Id')).toBeNull();
  });

  it('rejects path traversal that would escape /api/v1', () => {
    expect(() => resolveApiPath('/api/v1/../../evil')).toThrow(/escapes \/api\/v1/);
    expect(() => resolveApiPath('/api/v1/%2e%2e/%2e%2e/evil')).toThrow(
      /escapes \/api\/v1/,
    );
    expect(() => resolveApiPath('https://evil.example/api/v1/health')).toThrow(
      /relative/,
    );
  });

  it('merges Headers instances without dropping Accept', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const incoming = new Headers({ 'X-Request-Id': 'req-1' });
    await apiFetch('/health', { headers: incoming });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get('Accept')).toBe('application/json');
    expect(headers.get('X-Request-Id')).toBe('req-1');
  });

  it('apiJson throws clearly on non-JSON bodies', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('<html>nope</html>', { status: 502 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiJson('/health')).rejects.toThrow(/non-JSON/i);
  });

  it('fetch failures pass through without fabricating success', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiFetch('/health')).rejects.toThrow('Failed to fetch');
  });

  it('next.config rewrites proxy /api/v1/:path* to Express via allowlisted API_URL', async () => {
    const source = readFileSync(configPath, 'utf8');

    expect(source).toContain("source: '/api/v1/:path*'");
    expect(source).toContain('destination: `${apiUrl}/api/v1/:path*`');
    expect(source).toContain('resolveApiUrl');
    expect(source).not.toContain('NEXT_PUBLIC');

    vi.resetModules();
    vi.stubEnv('API_URL', 'http://backend:4000/');
    vi.stubEnv('NODE_ENV', 'development');
    const mod = await import('../../../next.config');
    const rewrites = await loadConfig(mod).rewrites?.();
    expect(rewrites).toEqual([
      {
        source: '/api/v1/:path*',
        destination: 'http://backend:4000/api/v1/:path*',
      },
    ]);
  });

  it('rewrites fall back to localhost:4000 when API_URL is unset in development', async () => {
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('API_URL', '');
    const emptyMod = await import('../../../next.config');
    expect(await loadConfig(emptyMod).rewrites?.()).toEqual([
      {
        source: '/api/v1/:path*',
        destination: 'http://localhost:4000/api/v1/:path*',
      },
    ]);

    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('API_URL', '   ');
    const blankMod = await import('../../../next.config');
    expect(await loadConfig(blankMod).rewrites?.()).toEqual([
      {
        source: '/api/v1/:path*',
        destination: 'http://localhost:4000/api/v1/:path*',
      },
    ]);
  });

  it('resolveApiUrl strips credentials and rejects bad hosts/schemes', async () => {
    vi.resetModules();
    const { resolveApiUrl } = await import('../../../next.config');

    expect(resolveApiUrl('http://user:secret@localhost:4000/extra', 'development')).toBe(
      'http://localhost:4000',
    );
    expect(resolveApiUrl('https://127.0.0.1:4000', 'development')).toBe(
      'https://127.0.0.1:4000',
    );
    expect(resolveApiUrl('http://[::1]:4000', 'development')).toBe(
      'http://[::1]:4000',
    );

    expect(() => resolveApiUrl('http://evil.example:4000', 'development')).toThrow(
      /allowlisted/,
    );
    expect(() => resolveApiUrl('ftp://localhost:4000', 'development')).toThrow(
      /http or https/,
    );
    expect(() => resolveApiUrl('not-a-url', 'development')).toThrow(/absolute URL/);
  });

  it('resolveApiUrl fails fast on production server when API_URL is missing, not during build', async () => {
    vi.resetModules();
    const { resolveApiUrl } = await import('../../../next.config');

    expect(resolveApiUrl('', 'production')).toBe('http://localhost:4000');
    expect(resolveApiUrl('', 'production', PHASE_PRODUCTION_BUILD)).toBe(
      'http://localhost:4000',
    );
    expect(() => resolveApiUrl('', 'production', PHASE_PRODUCTION_SERVER)).toThrow(
      /required in production/,
    );
    expect(() =>
      resolveApiUrl(undefined, 'production', PHASE_PRODUCTION_SERVER),
    ).toThrow(/required in production/);
    expect(resolveApiUrl('http://backend:4000', 'production')).toBe(
      'http://backend:4000',
    );
  });

  it('next.config load requires API_URL only for the production server phase', async () => {
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('API_URL', '');
    const mod = await import('../../../next.config');

    expect(await loadConfig(mod, PHASE_PRODUCTION_BUILD).rewrites?.()).toEqual([
      {
        source: '/api/v1/:path*',
        destination: 'http://localhost:4000/api/v1/:path*',
      },
    ]);
    expect(() => loadConfig(mod, PHASE_PRODUCTION_SERVER)).toThrow(
      /required in production/,
    );
  });
});
