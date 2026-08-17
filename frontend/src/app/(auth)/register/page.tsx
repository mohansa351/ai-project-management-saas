'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiErrorFieldMessages } from '@/features/auth/api-errors';
import { registerRequest } from '@/features/auth/auth-api';
import {
  AuthCard,
  AuthFormError,
  PASSWORD_HELPER,
} from '@/features/auth/components/auth-card';
import { registerSchema, type RegisterValues } from '@/features/auth/schemas';

export default function RegisterPage() {
  const router = useRouter();
  const [formError, setFormError] = useState<{ message: string; code?: string } | null>(
    null,
  );
  const form = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { name: '', email: '', password: '', confirmPassword: '' },
  });

  async function onSubmit(values: RegisterValues) {
    setFormError(null);
    const envelope = await registerRequest({
      name: values.name,
      email: values.email,
      password: values.password,
    });
    if (envelope.success) {
      router.replace(`/verify-email?email=${encodeURIComponent(values.email)}`);
      return;
    }
    const fields = apiErrorFieldMessages(envelope.error.details);
    for (const [name, message] of Object.entries(fields)) {
      if (name in values) {
        form.setError(name as keyof RegisterValues, { message });
      }
    }
    setFormError({ message: envelope.error.message, code: envelope.error.code });
  }

  return (
    <AuthCard
      title="Create an account"
      footer={
        <>
          Already have an account?{' '}
          <Link className="text-primary underline-offset-4 hover:underline" href="/login">
            Sign in
          </Link>
        </>
      }
    >
      <form className="flex flex-col gap-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
        {formError ? <AuthFormError message={formError.message} code={formError.code} /> : null}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="name">Name</Label>
          <Input id="name" autoComplete="name" {...form.register('name')} />
          {form.formState.errors.name ? (
            <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>
          ) : null}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" autoComplete="email" {...form.register('email')} />
          {form.formState.errors.email ? (
            <p className="text-xs text-destructive">{form.formState.errors.email.message}</p>
          ) : null}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password">Password</Label>
          <Input id="password" type="password" autoComplete="new-password" {...form.register('password')} />
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
            <p className="text-xs text-destructive">{form.formState.errors.confirmPassword.message}</p>
          ) : null}
        </div>
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? 'Creating account…' : 'Register'}
        </Button>
      </form>
    </AuthCard>
  );
}
