'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiErrorFieldMessages } from '@/features/auth/api-errors';
import { forgotPasswordRequest } from '@/features/auth/auth-api';
import { AuthCard, AuthFormError } from '@/features/auth/components/auth-card';
import { GENERIC_FORGOT_MESSAGE } from '@/features/auth/constants';
import {
  forgotPasswordSchema,
  type ForgotPasswordValues,
} from '@/features/auth/schemas';

export default function ForgotPasswordPage() {
  const [formError, setFormError] = useState<{ message: string; code?: string } | null>(
    null,
  );
  const [success, setSuccess] = useState<string | null>(null);
  const form = useForm<ForgotPasswordValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  });

  async function onSubmit(values: ForgotPasswordValues) {
    setFormError(null);
    setSuccess(null);
    const envelope = await forgotPasswordRequest(values.email);
    if (envelope.success) {
      setSuccess(envelope.data.message || GENERIC_FORGOT_MESSAGE);
      return;
    }
    const fields = apiErrorFieldMessages(envelope.error.details);
    if (fields.email) {
      form.setError('email', { message: fields.email });
    }
    setFormError({ message: envelope.error.message, code: envelope.error.code });
  }

  return (
    <AuthCard
      title="Forgot password"
      footer={
        <Link className="text-primary underline-offset-4 hover:underline" href="/login">
          Back to sign in
        </Link>
      }
    >
      <form className="flex flex-col gap-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
        {formError ? <AuthFormError message={formError.message} code={formError.code} /> : null}
        {success ? (
          <p data-testid="forgot-success" className="text-sm text-foreground">
            {success}
          </p>
        ) : null}
        <p className="text-sm text-muted-foreground">
          Enter your email. If an account exists, a reset link is logged by the mock mail
          provider.
        </p>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" autoComplete="email" {...form.register('email')} />
          {form.formState.errors.email ? (
            <p className="text-xs text-destructive">{form.formState.errors.email.message}</p>
          ) : null}
        </div>
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? 'Sending…' : 'Send reset link'}
        </Button>
      </form>
    </AuthCard>
  );
}
