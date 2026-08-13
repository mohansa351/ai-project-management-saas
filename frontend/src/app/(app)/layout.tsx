import type { ReactNode } from 'react';

import { AppShell } from '@/components/shell/app-shell';

/** App chrome stub layout — auth gates land in Epic 2. */
export default function AppShellLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <AppShell>{children}</AppShell>;
}
