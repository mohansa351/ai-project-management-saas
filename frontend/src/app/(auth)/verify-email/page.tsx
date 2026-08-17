'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiErrorFieldMessages } from '@/features/auth/api-errors';
import { resendVerificationRequest, verifyEmailRequest } from '@/features/auth/auth-api';
import { AuthCard, AuthFormError } from '@/features/auth/components/auth-card';
import { GENERIC_RESEND_MESSAGE } from '@/features/auth/constants';
import {
  resendVerificationSchema,
  type ResendVerificationValues,
} from '@/features/auth/schemas';

function stripTokenFromUrl() {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has('token')) return;
  url.searchParams.delete('token');
  const qs = url.searchParams.toString();
  window.history.replaceState(null, '', `${url.pathname}${qs ? `?${qs}` : ''}${url.hash}`);
}

function VerifyEmailForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token')?.trim() ?? '';
  const prefillEmail = searchParams.get('email')?.trim() ?? '';
  const [verifyState, setVerifyState] = useState<'idle' | 'pending' | 'ok' | 'error'>(
    token ? 'pending' : 'idle',
  );
  const [verifyError, setVerifyError] = useState<{ message: string; code?: string } | null>(
    null,
  );
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const [resendError, setResendError] = useState<{ message: string; code?: string } | null>(
    null,
  );

  const form = useForm<ResendVerificationValues>({
    resolver: zodResolver(resendVerificationSchema),
    defaultValues: { email: prefillEmail },
  });

  useEffect(() => {
    stripTokenFromUrl();
  }, []);

  useEffect(() => {
    if (!token) {
      return;
    }
    let cancelled = false;
    void (async () => {
      const envelope = await verifyEmailRequest(token);
      if (cancelled) return;
      if (envelope.success) {
        setVerifyState('ok');
        return;
      }
      setVerifyState('error');
      setVerifyError({ message: envelope.error.message, code: envelope.error.code });
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function onResend(values: ResendVerificationValues) {
    setResendError(null);
    setResendMessage(null);
    const envelope = await resendVerificationRequest(values.email);
    if (envelope.success) {
      setResendMessage(envelope.data.message || GENERIC_RESEND_MESSAGE);
      return;
    }
    const fields = apiErrorFieldMessages(envelope.error.details);
    if (fields.email) {
      form.setError('email', { message: fields.email });
    }
    setResendError({ message: envelope.error.message, code: envelope.error.code });
  }

  return (
    <AuthCard
      title="Verify email"
      footer={
        <Link className="text-primary underline-offset-4 hover:underline" href="/login">
          Back to sign in
        </Link>
      }
    >
      {verifyState === 'pending' ? (
        <p className="text-sm text-muted-foreground">Verifying your email…</p>
      ) : null}
      {verifyState === 'ok' ? (
        <p data-testid="verify-success" className="text-sm text-foreground">
          Email verified. You can sign in.
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          Check the mock mail log for a verification link, or request a new one below.
        </p>
      )}
      {verifyError ? <div className="mt-4"><AuthFormError message={verifyError.message} code={verifyError.code} /></div> : null}

      <form className="mt-6 flex flex-col gap-4" onSubmit={form.handleSubmit(onResend)} noValidate>
        {resendError ? <AuthFormError message={resendError.message} code={resendError.code} /> : null}
        {resendMessage ? (
          <p data-testid="resend-success" className="text-sm text-foreground">
            {resendMessage}
          </p>
        ) : null}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" autoComplete="email" {...form.register('email')} />
          {form.formState.errors.email ? (
            <p className="text-xs text-destructive">{form.formState.errors.email.message}</p>
          ) : null}
        </div>
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? 'Sending…' : 'Resend verification'}
        </Button>
      </form>
    </AuthCard>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense
      fallback={
        <AuthCard title="Verify email">
          <p className="text-center text-sm text-muted-foreground">Loading…</p>
        </AuthCard>
      }
    >
      <VerifyEmailForm />
    </Suspense>
  );
}
