import type { ReactNode } from 'react';

import { PRODUCT_NAME } from '@/features/auth/constants';

type AuthCardProps = {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
};

export function AuthCard({ title, children, footer }: AuthCardProps) {
  return (
    <div
      data-testid="auth-card"
      className="w-full max-w-[440px] rounded-lg border border-border bg-card p-6 shadow-none"
    >
      <p
        data-testid="auth-product-name"
        className="text-center text-[32px] font-semibold leading-[1.2] tracking-[-0.02em] text-primary"
      >
        {PRODUCT_NAME}
      </p>
      <h1 className="mt-4 text-center text-lg font-semibold text-foreground">{title}</h1>
      <div className="mt-6">{children}</div>
      {footer ? <div className="mt-6 text-center text-sm text-muted-foreground">{footer}</div> : null}
    </div>
  );
}

export function AuthFormError({
  message,
  code,
}: {
  message: string;
  code?: string;
}) {
  return (
    <div
      role="alert"
      data-testid="auth-form-error"
      className="rounded-md border border-destructive/30 bg-destructive-foreground px-3 py-2 text-sm text-destructive"
    >
      <p>{message}</p>
      {code ? (
        <p className="mt-1 font-mono text-xs text-destructive/80">{code}</p>
      ) : null}
    </div>
  );
}

export const PASSWORD_HELPER =
  'At least 8 characters. Passwords cannot exceed 72 bytes.';
