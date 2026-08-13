import '@testing-library/jest-dom/vitest';

import { vi } from 'vitest';

import { mockPathname, mockRedirect } from '@/test/navigation-mock';

vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname(),
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(),
  redirect: (...args: unknown[]) => mockRedirect(...args),
}));
