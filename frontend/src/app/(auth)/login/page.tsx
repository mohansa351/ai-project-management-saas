'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiErrorFieldMessages } from '@/features/auth/api-errors';
import { loginRequest } from '@/features/auth/auth-api';
import {
  AuthCard,
  AuthFormError,
  PASSWORD_HELPER,
} from '@/features/auth/components/auth-card';
import { safeNextPath } from '@/features/auth/next-path';
import { loginSchema, type LoginValues } from '@/features/auth/schemas';
import { refreshSession } from '@/features/auth/session-client';
import { useSessionStore } from '@/features/auth/session-store';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeNextPath(searchParams.get('next'));
  const [checking, setChecking] = useState(true);
  const [formError, setFormError] = useState<{ message: string; code?: string } | null>(
    null,
  );

  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        if (useSessionStore.getState().status === 'authenticated') {
          if (!cancelled) router.replace(next);
          return;
        }
        const ok = await refreshSession();
        if (cancelled) return;
        if (ok) {
          router.replace(next);
          return;
        }
      } catch {
        // Network / parse failures: show the form.
      }
      if (!cancelled) {
        setChecking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [next, router]);

  async function onSubmit(values: LoginValues) {
    setFormError(null);
    const envelope = await loginRequest(values.email, values.password);
    if (envelope.success) {
      router.replace(next);
      return;
    }
    if (envelope.error.code === 'EMAIL_NOT_VERIFIED') {
      router.replace(`/verify-email?email=${encodeURIComponent(values.email)}`);
      return;
    }
    const fields = apiErrorFieldMessages(envelope.error.details);
    for (const [name, message] of Object.entries(fields)) {
      if (name === 'email' || name === 'password') {
        form.setError(name, { message });
      }
    }
    setFormError({ message: envelope.error.message, code: envelope.error.code });
  }

  if (checking) {
    return (
      <AuthCard title="Sign in">
        <p data-testid="login-checking" className="text-center text-sm text-muted-foreground">
          Checking session…
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Sign in"
      footer={
        <>
          Need an account?{' '}
          <Link className="text-primary underline-offset-4 hover:underline" href="/register">
            Register
          </Link>
        </>
      }
    >
      <form className="flex flex-col gap-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
        {formError ? <AuthFormError message={formError.message} code={formError.code} /> : null}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            aria-invalid={!!form.formState.errors.email}
            {...form.register('email')}
          />
          {form.formState.errors.email ? (
            <p className="text-xs text-destructive">{form.formState.errors.email.message}</p>
          ) : null}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            aria-invalid={!!form.formState.errors.password}
            {...form.register('password')}
          />
          <p className="text-xs text-muted-foreground">{PASSWORD_HELPER}</p>
          {form.formState.errors.password ? (
            <p className="text-xs text-destructive">{form.formState.errors.password.message}</p>
          ) : null}
        </div>
        <p className="text-sm">
          <Link className="text-primary underline-offset-4 hover:underline" href="/forgot-password">
            Forgot password?
          </Link>
        </p>
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </AuthCard>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <AuthCard title="Sign in">
          <p className="text-center text-sm text-muted-foreground">Loading…</p>
        </AuthCard>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
