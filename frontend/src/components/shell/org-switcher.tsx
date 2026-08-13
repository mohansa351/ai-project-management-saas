'use client';

import { cn } from '@/lib/utils';

type OrgSwitcherProps = {
  /** Desktop rail: collapse label below lg. */
  responsive?: boolean;
  /** Mobile sheet: always show full label. */
  forceExpanded?: boolean;
  className?: string;
};

/** Stub org switcher — no real org switching until later epics. */
export function OrgSwitcher({
  responsive = false,
  forceExpanded = false,
  className,
}: OrgSwitcherProps) {
  const collapsedChrome = responsive && !forceExpanded;

  return (
    <button
      type="button"
      data-testid="org-switcher"
      aria-label="Organization switcher (unavailable)"
      disabled
      className={cn(
        'flex w-full items-center gap-2 rounded-md border border-border bg-card px-3 text-left text-sm text-foreground',
        'min-h-11 cursor-default opacity-80',
        collapsedChrome ? 'justify-center px-0 lg:justify-start lg:px-3' : 'justify-start',
        className,
      )}
    >
      <span
        className={cn(
          'text-xs font-semibold text-primary',
          collapsedChrome ? 'inline lg:hidden' : 'hidden',
        )}
        aria-hidden
      >
        Ac
      </span>
      <span
        className={cn(
          'truncate font-medium',
          collapsedChrome ? 'hidden lg:inline' : 'inline',
        )}
      >
        Acme Technologies
      </span>
    </button>
  );
}
