'use client';

import { useEffect, useState } from 'react';
import { Bell, Menu, User } from 'lucide-react';
import { usePathname } from 'next/navigation';

import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { primaryNavItems } from '@/components/shell/nav-items';
import { Sidebar } from '@/components/shell/sidebar';
import { cn } from '@/lib/utils';

type TopbarProps = {
  title?: string;
  className?: string;
};

function titleFromPath(pathname: string): string {
  const match = primaryNavItems.find(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  );
  return match?.label ?? 'APM';
}

export function Topbar({ title, className }: TopbarProps) {
  const pathname = usePathname();
  const resolvedTitle = title ?? titleFromPath(pathname);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  return (
    <header
      data-testid="topbar"
      className={cn(
        'flex h-[var(--spacing-topbar)] items-center justify-between border-b border-border bg-card px-[var(--spacing-content-gutter-mobile)] md:px-[var(--spacing-content-gutter)]',
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
          <SheetTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="md:hidden"
              data-testid="mobile-nav-trigger"
              aria-label="Open navigation"
            >
              <Menu className="size-5" />
            </Button>
          </SheetTrigger>
          <SheetContent
            side="left"
            className="gap-0 p-0"
            showCloseButton={false}
            data-testid="mobile-nav-sheet"
          >
            <SheetHeader className="sr-only">
              <SheetTitle>Navigation</SheetTitle>
            </SheetHeader>
            <Sidebar mobile />
          </SheetContent>
        </Sheet>
        <h1
          data-testid="topbar-title"
          className="text-lg font-semibold text-foreground"
        >
          {resolvedTitle}
        </h1>
      </div>

      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Notifications"
          data-testid="notification-bell"
        >
          <Bell className="size-5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="User menu"
          data-testid="user-menu"
        >
          <User className="size-5" />
        </Button>
      </div>
    </header>
  );
}
