'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { OrgSwitcher } from '@/components/shell/org-switcher';
import { primaryNavItems } from '@/components/shell/nav-items';
import { cn } from '@/lib/utils';

type SidebarProps = {
  className?: string;
  /** When true, render for mobile Sheet (always expanded labels). */
  mobile?: boolean;
};

/**
 * Desktop/tablet: expanded ≥lg (240px), icon-collapsed md–&lt;lg (64px).
 * Mobile sheet: pass `mobile` for always-expanded labels.
 */
export function Sidebar({ className, mobile = false }: SidebarProps) {
  const pathname = usePathname();

  return (
    <aside
      data-testid={mobile ? 'sidebar-mobile' : 'sidebar'}
      data-mode={mobile ? 'mobile' : 'responsive'}
      className={cn(
        'flex h-full flex-col border-r border-border bg-card',
        mobile
          ? 'w-[var(--spacing-sidebar)]'
          : 'w-[var(--spacing-sidebar-collapsed)] lg:w-[var(--spacing-sidebar)]',
        className,
      )}
    >
      <div
        className={cn(
          'flex h-[var(--spacing-topbar)] items-center border-b border-border',
          mobile ? 'px-4' : 'justify-center px-3 lg:justify-start lg:px-4',
        )}
      >
        <Link
          href="/dashboard"
          data-testid="wordmark"
          className={cn(
            'font-semibold tracking-tight text-primary',
            mobile ? 'text-lg' : 'text-sm lg:text-lg',
          )}
        >
          APM
        </Link>
      </div>

      <div className={cn('p-3', !mobile && 'px-2 lg:px-3')}>
        <OrgSwitcher responsive={!mobile} forceExpanded={mobile} />
      </div>

      <nav
        aria-label="Primary"
        className={cn(
          'flex flex-1 flex-col gap-1 px-2 pb-4',
          !mobile && 'items-center lg:items-stretch',
        )}
      >
        {primaryNavItems.map((item) => {
          const Icon = item.icon;
          const active =
            pathname === item.href || pathname.startsWith(`${item.href}/`);

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-label={item.label}
              aria-current={active ? 'page' : undefined}
              data-testid={`nav-${item.label.toLowerCase()}`}
              className={cn(
                'relative flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors',
                !mobile && 'w-11 justify-center px-0 lg:w-auto lg:justify-start lg:px-3',
                active
                  ? 'bg-muted text-primary before:absolute before:inset-y-1 before:left-0 before:w-0.5 before:rounded-full before:bg-primary'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <Icon className="size-5 shrink-0" aria-hidden />
              <span className={cn(mobile ? 'inline' : 'hidden lg:inline')}>
                {item.label}
              </span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
