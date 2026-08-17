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
import { resetPasswordRequest } from '@/features/auth/auth-api';
import {
  AuthCard,
  AuthFormError,
  PASSWORD_HELPER,
} from '@/features/auth/components/auth-card';
import {
  resetPasswordSchema,
  type ResetPasswordValues,
} from '@/features/auth/schemas';

function stripTokenFromUrl() {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has('token')) return;
  url.searchParams.delete('token');
  const qs = url.searchParams.toString();
  window.history.replaceState(null, '', `${url.pathname}${qs ? `?${qs}` : ''}${url.hash}`);
}

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token')?.trim() ?? '';
  const [formError, setFormError] = useState<{ message: string; code?: string } | null>(
    null,
  );
  const [success, setSuccess] = useState<string | null>(null);
  const form = useForm<ResetPasswordValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: '', confirmPassword: '' },
  });

  useEffect(() => {
    stripTokenFromUrl();
  }, []);

  async function onSubmit(values: ResetPasswordValues) {
    setFormError(null);
    if (!token) {
      setFormError({
        message: 'This reset link is invalid or has expired.',
        code: 'AUTH_TOKEN_INVALID',
      });
      return;
    }
    const envelope = await resetPasswordRequest(token, values.password);
    if (envelope.success) {
      setSuccess(envelope.data.message);
      return;
    }
    const fields = apiErrorFieldMessages(envelope.error.details);
    if (fields.password) {
      form.setError('password', { message: fields.password });
    }
    setFormError({ message: envelope.error.message, code: envelope.error.code });
  }

  return (
    <AuthCard
      title="Reset password"
      footer={
        success ? (
          <Link className="text-primary underline-offset-4 hover:underline" href="/login">
            Sign in
          </Link>
        ) : (
          <Link className="text-primary underline-offset-4 hover:underline" href="/forgot-password">
            Request a new link
          </Link>
        )
      }
    >
      {success ? (
        <p data-testid="reset-success" className="text-sm text-foreground">
          {success}
        </p>
      ) : (
        <form className="flex flex-col gap-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
          {formError ? <AuthFormError message={formError.message} code={formError.code} /> : null}
          {!token ? (
            <AuthFormError
              message="This reset link is missing a token. Request a new link."
              code="AUTH_TOKEN_INVALID"
            />
          ) : null}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password">New password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              {...form.register('password')}
            />
            <p className="text-xs text-muted-foreground">{PASSWORD_HELPER}</p>
            {form.formState.errors.password ? (
              <p className="text-xs text-destructive">{form.formState.errors.password.message}</p>
            ) : null}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="confirmPassword">Confirm password</Label>
            <Input
              id="confirmPassword"
              type="password"
              autoComplete="new-password"
              {...form.register('confirmPassword')}
            />
            {form.formState.errors.confirmPassword ? (
              <p className="text-xs text-destructive">
                {form.formState.errors.confirmPassword.message}
              </p>
            ) : null}
          </div>
          <Button type="submit" disabled={form.formState.isSubmitting || !token}>
            {form.formState.isSubmitting ? 'Saving…' : 'Reset password'}
          </Button>
        </form>
      )}
      {success ? (
        <Button className="mt-4 w-full" type="button" onClick={() => router.replace('/login')}>
          Continue to sign in
        </Button>
      ) : null}
    </AuthCard>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <AuthCard title="Reset password">
          <p className="text-center text-sm text-muted-foreground">Loading…</p>
        </AuthCard>
      }
    >
      <ResetPasswordForm />
    </Suspense>
  );
}
