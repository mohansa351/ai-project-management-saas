import { vi } from 'vitest';

export const mockPathname = vi.fn(() => '/dashboard');
export const mockRedirect = vi.fn();
export const mockReplace = vi.fn();
export const mockPush = vi.fn();
export const mockSearchParams = vi.fn(() => new URLSearchParams());
