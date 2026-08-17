'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiErrorFieldMessages } from '@/features/auth/api-errors';
import { changePasswordRequest } from '@/features/auth/auth-api';
import { AuthFormError, PASSWORD_HELPER } from '@/features/auth/components/auth-card';
import {
  changePasswordSchema,
  type ChangePasswordValues,
} from '@/features/auth/schemas';

export default function SecuritySettingsPage() {
  const [formError, setFormError] = useState<{ message: string; code?: string } | null>(
    null,
  );
  const [success, setSuccess] = useState<string | null>(null);
  const form = useForm<ChangePasswordValues>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  async function onSubmit(values: ChangePasswordValues) {
    setFormError(null);
    setSuccess(null);
    const envelope = await changePasswordRequest({
      currentPassword: values.currentPassword,
      newPassword: values.newPassword,
    });
    if (envelope.success) {
      setSuccess('Password changed. This device stays signed in.');
      form.reset();
      return;
    }
    const fields = apiErrorFieldMessages(envelope.error.details);
    for (const [name, message] of Object.entries(fields)) {
      if (name === 'currentPassword' || name === 'newPassword' || name === 'confirmPassword') {
        form.setError(name, { message });
      }
    }
    setFormError({ message: envelope.error.message, code: envelope.error.code });
  }

  return (
    <div className="mx-auto w-full max-w-[440px]">
      <h2 className="text-2xl font-semibold tracking-tight text-foreground">Security</h2>
      <p className="mt-1 text-sm text-muted-foreground">Change your password.</p>
      <form
        className="mt-6 flex flex-col gap-4"
        onSubmit={form.handleSubmit(onSubmit)}
        noValidate
        data-testid="change-password-form"
      >
        {formError ? <AuthFormError message={formError.message} code={formError.code} /> : null}
        {success ? (
          <p data-testid="change-password-success" className="text-sm text-foreground">
            {success}
          </p>
        ) : null}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="currentPassword">Current password</Label>
          <Input
            id="currentPassword"
            type="password"
            autoComplete="current-password"
            {...form.register('currentPassword')}
          />
          {form.formState.errors.currentPassword ? (
            <p className="text-xs text-destructive">
              {form.formState.errors.currentPassword.message}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="newPassword">New password</Label>
          <Input
            id="newPassword"
            type="password"
            autoComplete="new-password"
            {...form.register('newPassword')}
          />
          <p className="text-xs text-muted-foreground">{PASSWORD_HELPER}</p>
          {form.formState.errors.newPassword ? (
            <p className="text-xs text-destructive">{form.formState.errors.newPassword.message}</p>
          ) : null}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="confirmPassword">Confirm new password</Label>
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
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? 'Saving…' : 'Change password'}
        </Button>
      </form>
    </div>
  );
}
