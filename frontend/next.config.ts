import type { NextConfig } from 'next';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function resolveApiUrl(): string {
  const raw = process.env.API_URL?.trim();
  const base = raw && raw.length > 0 ? raw : 'http://localhost:4000';
  return base.replace(/\/+$/, '');
}

const apiUrl = resolveApiUrl();

const nextConfig: NextConfig = {
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

export default nextConfig;
