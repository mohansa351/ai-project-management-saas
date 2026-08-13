import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import AppShellLayout from '@/app/(app)/layout';
import { AppShell } from '@/components/shell/app-shell';
import { primaryNavItems } from '@/components/shell/nav-items';
import { mockPathname } from '@/test/navigation-mock';

const here = path.dirname(fileURLToPath(import.meta.url));
const shellSrcDir = here;
const globalsCssPath = path.resolve(here, '../../app/globals.css');
const rootPagePath = path.resolve(here, '../../app/page.tsx');

function readShellSources(): string {
  const files = [
    'app-shell.tsx',
    'sidebar.tsx',
    'topbar.tsx',
    'org-switcher.tsx',
    'nav-items.ts',
  ];
  return files
    .map((file) => readFileSync(path.join(shellSrcDir, file), 'utf8'))
    .join('\n');
}

function collectClassNames(root: HTMLElement): string {
  return Array.from(root.querySelectorAll('*'))
    .map((el) => el.className?.toString?.() ?? '')
    .concat(root.className?.toString?.() ?? '')
    .join(' ');
}

beforeEach(() => {
  mockPathname.mockReturnValue('/dashboard');
});

afterEach(() => {
  cleanup();
});

describe('shell breakpoints matrix', () => {
  it('desktop ≥lg: expanded 240px sidebar + 56px topbar + APM + nav/org stubs', () => {
    render(
      <AppShell>
        <p>content</p>
      </AppShell>,
    );

    const sidebar = screen.getByTestId('sidebar');
    expect(sidebar.className).toContain('lg:w-[var(--spacing-sidebar)]');
    expect(sidebar.className).toContain(
      'w-[var(--spacing-sidebar-collapsed)]',
    );

    const topbar = screen.getByTestId('topbar');
    expect(topbar.className).toContain('h-[var(--spacing-topbar)]');
    expect(topbar.className).toContain('sticky');

    expect(within(sidebar).getByTestId('wordmark')).toHaveTextContent('APM');
    expect(within(sidebar).getByTestId('wordmark')).toHaveAttribute(
      'href',
      '/dashboard',
    );
    const wordmark = within(sidebar).getByTestId('wordmark');
    expect(wordmark.className).toMatch(/min-h-11/);
    expect(wordmark.className).toMatch(/focus-visible:ring-2/);
    expect(within(sidebar).getByTestId('org-switcher')).toBeInTheDocument();
    expect(within(sidebar).getByTestId('org-switcher')).toBeDisabled();

    for (const item of primaryNavItems) {
      const link = within(sidebar).getByTestId(
        `nav-${item.label.toLowerCase()}`,
      );
      expect(link).toBeInTheDocument();
      expect(link).toHaveAttribute('href', item.href);
      expect(link.className).toMatch(/focus-visible:ring-2/);
    }

    expect(within(sidebar).queryByTestId('nav-admin')).not.toBeInTheDocument();

    const dashboard = within(sidebar).getByTestId('nav-dashboard');
    expect(dashboard).toHaveAttribute('aria-current', 'page');
    expect(dashboard.querySelector('span')?.className).toContain('lg:inline');
  });

  it('tablet md–<lg: 64px collapsed sidebar', () => {
    render(
      <AppShell>
        <p>content</p>
      </AppShell>,
    );

    const rail = screen.getByTestId('sidebar-rail');
    expect(rail.className).toContain('md:block');
    expect(rail.className).toContain('hidden');
    expect(rail.className).toContain('sticky');

    const sidebar = screen.getByTestId('sidebar');
    expect(sidebar.className).toContain(
      'w-[var(--spacing-sidebar-collapsed)]',
    );
    expect(sidebar.className).toContain('lg:w-[var(--spacing-sidebar)]');

    const dashboard = within(sidebar).getByTestId('nav-dashboard');
    expect(dashboard.className).toContain('w-11');
    expect(dashboard.className).toContain('lg:w-auto');
    expect(dashboard.querySelector('span')?.className).toContain('hidden');
  });

  it('mobile <md: hamburger opens Sheet navigation without overlapping close', async () => {
    const user = userEvent.setup();
    render(
      <AppShell>
        <p>content</p>
      </AppShell>,
    );

    const rail = screen.getByTestId('sidebar-rail');
    expect(rail.className).toContain('hidden');
    expect(rail.className).toContain('md:block');

    const trigger = screen.getByTestId('mobile-nav-trigger');
    expect(trigger.className).toContain('md:hidden');
    expect(trigger.className).toMatch(/min-h-11|h-11/);

    await user.click(trigger);

    const sheet = await screen.findByTestId('mobile-nav-sheet');
    expect(sheet).toBeInTheDocument();
    expect(within(sheet).getByTestId('sidebar-mobile')).toBeInTheDocument();
    expect(within(sheet).getByTestId('wordmark')).toHaveTextContent('APM');
    expect(within(sheet).queryByTestId('sheet-close')).not.toBeInTheDocument();
  });

  it('topbar heading reflects mocked pathname', () => {
    mockPathname.mockReturnValue('/projects');
    render(
      <AppShell>
        <p>content</p>
      </AppShell>,
    );

    expect(screen.getByTestId('topbar-title')).toHaveTextContent('Projects');
  });

  it('(app) layout wraps children with AppShell', () => {
    render(
      <AppShellLayout>
        <p data-testid="child">inside</p>
      </AppShellLayout>,
    );

    expect(screen.getByTestId('app-shell')).toBeInTheDocument();
    expect(screen.getByTestId('child')).toHaveTextContent('inside');
  });

  it('root page redirects to /dashboard', () => {
    const source = readFileSync(rootPagePath, 'utf8');
    expect(source).toContain("redirect('/dashboard')");
  });
});

describe('design tokens matrix', () => {
  it('light tokens expose primary #0F3D5E and canvas #F4F6F8; teal unused in chrome', () => {
    const globals = readFileSync(globalsCssPath, 'utf8');

    expect(globals).toMatch(/--primary:\s*#0f3d5e/i);
    expect(globals).toMatch(/--background:\s*#f4f6f8/i);
    expect(globals).toMatch(/--accent:\s*#0f766e/i);
    expect(globals).toContain("tw-animate-css");

    const shellSource = readShellSources();
    expect(shellSource).not.toMatch(/#0[Ff]766[Ee]/);
    expect(shellSource).not.toMatch(/\bbg-accent\b/);
    expect(shellSource).not.toMatch(/\btext-accent\b/);
    expect(shellSource).not.toMatch(/\bborder-accent\b/);
    expect(shellSource).not.toMatch(/variant=["']ai["']/);

    const { container } = render(
      <AppShell>
        <p>content</p>
      </AppShell>,
    );
    const classes = collectClassNames(container as HTMLElement);
    expect(classes).not.toMatch(/\bbg-accent\b/);
    expect(classes).not.toMatch(/\btext-accent\b/);
    expect(classes).not.toMatch(/\bborder-accent\b/);
  });
});
