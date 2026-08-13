import type { NextConfig } from 'next';
import { PHASE_PRODUCTION_SERVER } from 'next/constants';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Hosts safe for local `next dev` and Compose service DNS. */
const ALLOWED_API_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'backend']);

/**
 * Resolve server-only rewrite target.
 * - Development/test/`next build`: default `http://localhost:4000` when unset.
 * - `next start` (production server): require `API_URL`.
 * - Always: absolute http(s), no credentials, allowlisted host.
 */
export function resolveApiUrl(
  rawEnv: string | undefined = process.env.API_URL,
  nodeEnv: string | undefined = process.env.NODE_ENV,
  phase?: string,
): string {
  const raw = rawEnv?.trim() ?? '';
  // `nodeEnv` is part of the public helper signature (tests pass it); fail-fast
  // is phase-gated so `next build` (NODE_ENV=production) still defaults locally.
  void nodeEnv;
  const requireUrl = phase === PHASE_PRODUCTION_SERVER;

  if (!raw) {
    if (requireUrl) {
      throw new Error(
        'API_URL is required in production (absolute http(s) URL to Express)',
      );
    }
    return 'http://localhost:4000';
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`API_URL must be an absolute URL, received: ${raw}`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(
      `API_URL must use http or https, received protocol: ${parsed.protocol}`,
    );
  }

  if (parsed.username || parsed.password) {
    parsed.username = '';
    parsed.password = '';
  }

  const host = parsed.hostname.toLowerCase();
  if (!ALLOWED_API_HOSTS.has(host)) {
    throw new Error(
      `API_URL host "${parsed.hostname}" is not allowlisted for local/dev (allowed: ${[...ALLOWED_API_HOSTS].join(', ')})`,
    );
  }

  // Origin only — drop path/query/hash; rewrite appends `/api/v1/:path*`.
  return parsed.origin;
}

function createNextConfig(phase?: string): NextConfig {
  const apiUrl = resolveApiUrl(process.env.API_URL, process.env.NODE_ENV, phase);

  return {
    // Monorepo: silence Turbopack picking the wrong workspace root
    turbopack: {
      root: path.join(path.dirname(fileURLToPath(import.meta.url)), '..'),
    },
    async rewrites() {
      return [
        {
          source: '/api/v1/:path*',
          destination: `${apiUrl}/api/v1/:path*`,
        },
      ];
    },
  };
}

export default function nextConfig(phase?: string): NextConfig {
  return createNextConfig(phase);
}
