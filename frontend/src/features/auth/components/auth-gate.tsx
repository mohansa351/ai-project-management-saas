'use client';

import { type ReactNode, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';

import { bootstrapSession } from '@/features/auth/session-client';
import { useSessionStore } from '@/features/auth/session-store';

type AuthGateProps = {
  children: ReactNode;
};

export function AuthGate({ children }: AuthGateProps) {
  const status = useSessionStore((s) => s.status);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status === 'unknown') {
      void bootstrapSession();
    }
  }, [status]);

  useEffect(() => {
    if (status !== 'unauthenticated') {
      return;
    }
    const next = pathname && pathname !== '/login' ? pathname : '/dashboard';
    const encoded = encodeURIComponent(next.startsWith('/') ? next : '/dashboard');
    router.replace(`/login?next=${encoded}`);
  }, [status, pathname, router]);

  if (status === 'authenticated') {
    return <>{children}</>;
  }

  if (status === 'unauthenticated') {
    return (
      <div
        data-testid="auth-redirecting"
        className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground"
      >
        Redirecting to sign in…
      </div>
    );
  }

  return (
    <div
      data-testid="auth-loading"
      className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground"
    >
      Restoring session…
    </div>
  );
}
