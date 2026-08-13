'use client';

import type { ReactNode } from 'react';

import { Sidebar } from '@/components/shell/sidebar';
import { Topbar } from '@/components/shell/topbar';

type AppShellProps = {
  children: ReactNode;
  title?: string;
};

/**
 * Authenticated chrome stub.
 * Breakpoints: ≥lg expanded (240px), md–&lt;lg collapsed (64px), &lt;md Sheet via topbar.
 * Sidebar + topbar stay pinned; main is the scroll container.
 */
export function AppShell({ children, title }: AppShellProps) {
  return (
    <div
      data-testid="app-shell"
      className="flex h-screen overflow-hidden bg-background text-foreground"
    >
      {/* Desktop / tablet sidebar — hidden below md; width collapses below lg */}
      <div
        className="sticky top-0 hidden h-screen shrink-0 md:block"
        data-testid="sidebar-rail"
      >
        <Sidebar />
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <Topbar title={title} className="sticky top-0 z-10 shrink-0" />
        <main className="flex-1 overflow-y-auto px-[var(--spacing-content-gutter-mobile)] py-6 md:px-[var(--spacing-content-gutter)]">
          {children}
        </main>
      </div>
    </div>
  );
}
