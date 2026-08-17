'use client';

import { useEffect, useRef, useState } from 'react';
import { Bell, Menu, User } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { primaryNavItems } from '@/components/shell/nav-items';
import { Sidebar } from '@/components/shell/sidebar';
import { logoutSession } from '@/features/auth/session-client';
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
  const router = useRouter();
  const resolvedTitle = title ?? titleFromPath(pathname);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMobileNavOpen(false);
    setUserMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!userMenuOpen) return undefined;
    function onPointer(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setUserMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', onPointer);
    return () => document.removeEventListener('mousedown', onPointer);
  }, [userMenuOpen]);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia('(min-width: 768px)');
    const onChange = () => {
      if (mq.matches) setMobileNavOpen(false);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

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
              <SheetDescription>Primary application navigation</SheetDescription>
            </SheetHeader>
            <Sidebar mobile onNavigate={() => setMobileNavOpen(false)} />
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
        <div className="relative" ref={menuRef}>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="User menu"
            aria-expanded={userMenuOpen}
            aria-haspopup="menu"
            data-testid="user-menu"
            onClick={() => setUserMenuOpen((open) => !open)}
          >
            <User className="size-5" />
          </Button>
          {userMenuOpen ? (
            <div
              role="menu"
              data-testid="user-menu-panel"
              className="absolute right-0 z-20 mt-1 min-w-44 rounded-md border border-border bg-card py-1 shadow-sm"
            >
              <Link
                href="/settings/security"
                role="menuitem"
                className="block px-3 py-2 text-sm text-foreground hover:bg-muted"
                onClick={() => setUserMenuOpen(false)}
              >
                Security
              </Link>
              <button
                type="button"
                role="menuitem"
                data-testid="logout-button"
                className="block w-full px-3 py-2 text-left text-sm text-foreground hover:bg-muted disabled:opacity-50"
                disabled={loggingOut}
                onClick={async () => {
                  setLoggingOut(true);
                  await logoutSession();
                  router.replace('/login');
                }}
              >
                {loggingOut ? 'Signing out…' : 'Logout'}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
