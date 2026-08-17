import type { ReactNode } from 'react';

import { AuthGate } from '@/features/auth/components/auth-gate';
import { AppShell } from '@/components/shell/app-shell';

/** Authenticated chrome — client AuthGate restores the HttpOnly session via refresh. */
export default function AppShellLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <AuthGate>
      <AppShell>{children}</AppShell>
    </AuthGate>
  );
}
