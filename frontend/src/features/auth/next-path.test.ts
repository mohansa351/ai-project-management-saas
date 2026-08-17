import { describe, expect, it } from 'vitest';

import { DEFAULT_AFTER_LOGIN } from '@/features/auth/constants';
import { safeNextPath } from '@/features/auth/next-path';

describe('safeNextPath', () => {
  it('defaults empty values to dashboard', () => {
    expect(safeNextPath(null)).toBe(DEFAULT_AFTER_LOGIN);
    expect(safeNextPath(undefined)).toBe(DEFAULT_AFTER_LOGIN);
    expect(safeNextPath('')).toBe(DEFAULT_AFTER_LOGIN);
  });

  it('allows internal relative paths', () => {
    expect(safeNextPath('/dashboard')).toBe('/dashboard');
    expect(safeNextPath('/settings/security')).toBe('/settings/security');
    expect(safeNextPath('/projects?q=1')).toBe('/projects?q=1');
  });

  it('rejects open redirects and login loops', () => {
    expect(safeNextPath('https://evil.example/phish')).toBe(DEFAULT_AFTER_LOGIN);
    expect(safeNextPath('//evil.example')).toBe(DEFAULT_AFTER_LOGIN);
    expect(safeNextPath('/\\evil')).toBe(DEFAULT_AFTER_LOGIN);
    expect(safeNextPath('/login')).toBe(DEFAULT_AFTER_LOGIN);
    expect(safeNextPath('/login?next=/dashboard')).toBe(DEFAULT_AFTER_LOGIN);
    expect(safeNextPath('/api/v1/auth/login')).toBe(DEFAULT_AFTER_LOGIN);
  });
});
