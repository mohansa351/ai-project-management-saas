import type { ReactNode } from 'react';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div
      data-testid="auth-layout"
      className="flex min-h-screen items-center justify-center bg-background px-4 py-8"
    >
      {children}
    </div>
  );
}
