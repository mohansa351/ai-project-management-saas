import '@testing-library/jest-dom/vitest';

import { vi } from 'vitest';

import {
  mockPathname,
  mockPush,
  mockRedirect,
  mockReplace,
  mockSearchParams,
} from '@/test/navigation-mock';

// jsdom throws on <a href> navigation; router mocks handle routing in tests.
window.addEventListener(
  'click',
  (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    if (target.closest('a[href]')) {
      event.preventDefault();
    }
  },
  true,
);

vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname(),
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
    prefetch: vi.fn(),
  }),
  useSearchParams: () => mockSearchParams(),
  redirect: (...args: unknown[]) => mockRedirect(...args),
}));
