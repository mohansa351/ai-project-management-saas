import { DEFAULT_AFTER_LOGIN } from '@/features/auth/constants';

/**
 * Allow only same-origin relative paths for post-login `next`.
 * Rejects protocol-relative, absolute, backslash, and `/login` loops.
 */
export function safeNextPath(raw: string | null | undefined): string {
  if (raw == null) {
    return DEFAULT_AFTER_LOGIN;
  }
  const trimmed = raw.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//') || trimmed.includes('\\')) {
    return DEFAULT_AFTER_LOGIN;
  }
  if (trimmed.startsWith('/login')) {
    return DEFAULT_AFTER_LOGIN;
  }

  try {
    const resolved = new URL(trimmed, 'http://apm.invalid');
    if (resolved.origin !== 'http://apm.invalid') {
      return DEFAULT_AFTER_LOGIN;
    }
    if (resolved.pathname === '/api' || resolved.pathname.startsWith('/api/')) {
      return DEFAULT_AFTER_LOGIN;
    }
    const path = `${resolved.pathname}${resolved.search}${resolved.hash}`;
    return path.startsWith('/') && !path.startsWith('//') ? path : DEFAULT_AFTER_LOGIN;
  } catch {
    return DEFAULT_AFTER_LOGIN;
  }
}
