import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { apiFetch, apiJson, getApiBasePath } from '@/lib/api/client';

const configPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../next.config.ts',
);

describe('API rewrite matrix', () => {
  afterEach(() => {
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
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit?];
    expect(url).toBe('/api/v1/health');
    expect(url.startsWith('/api/v1')).toBe(true);
    expect(url).not.toMatch(/^https?:\/\//);
    expect(url).not.toContain('localhost:4000');
    expect(url).not.toContain('NEXT_PUBLIC');
  });

  it('does not double /api/v1 when caller already includes the prefix', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await apiFetch('/api/v1/health');

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit?];
    expect(url).toBe('/api/v1/health');
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

  it('next.config rewrites proxy /api/v1/:path* to Express via API_URL', async () => {
    const source = readFileSync(configPath, 'utf8');

    expect(source).toContain("source: '/api/v1/:path*'");
    expect(source).toContain('destination: `${apiUrl}/api/v1/:path*`');
    expect(source).toContain('resolveApiUrl');
    expect(source).not.toContain('NEXT_PUBLIC');

    vi.resetModules();
    vi.stubEnv('API_URL', 'http://express.test:4000/');
    const mod = await import('../../../next.config');
    const config = mod.default;
    const rewrites = await config.rewrites?.();
    expect(rewrites).toEqual([
      {
        source: '/api/v1/:path*',
        destination: 'http://express.test:4000/api/v1/:path*',
      },
    ]);
  });

  it('rewrites fall back to localhost:4000 when API_URL is unset or empty', async () => {
    vi.resetModules();
    vi.stubEnv('API_URL', '');
    const emptyMod = await import('../../../next.config');
    expect(await emptyMod.default.rewrites?.()).toEqual([
      {
        source: '/api/v1/:path*',
        destination: 'http://localhost:4000/api/v1/:path*',
      },
    ]);

    vi.resetModules();
    vi.stubEnv('API_URL', '   ');
    const blankMod = await import('../../../next.config');
    expect(await blankMod.default.rewrites?.()).toEqual([
      {
        source: '/api/v1/:path*',
        destination: 'http://localhost:4000/api/v1/:path*',
      },
    ]);
  });
});
