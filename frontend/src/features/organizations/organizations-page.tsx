'use client';

import { FormEvent, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiErrorFieldMessages } from '@/features/auth/api-errors';
import { AuthFormError } from '@/features/auth/components/auth-card';
import { useSessionStore } from '@/features/auth/session-store';
import {
  createOrganizationRequest,
  organizationsQueryKey,
} from '@/features/organizations/org-api';
import { useOrganizationsQuery } from '@/features/organizations/use-organizations-query';

export function OrganizationsPage() {
  const queryClient = useQueryClient();
  const currentOrganizationId = useSessionStore((s) => s.currentOrganizationId);
  const setCurrentOrganizationId = useSessionStore((s) => s.setCurrentOrganizationId);
  const query = useOrganizationsQuery();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<{ message: string; code?: string } | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const creatingRef = useRef(false);

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    if (creatingRef.current) {
      return;
    }
    setFormError(null);
    setSuccess(null);
    const trimmedName = name.trim();
    const trimmedSlug = slug.trim();
    if (!trimmedName) {
      setFieldErrors({ name: 'Name is required.' });
      return;
    }
    setFieldErrors({});
    creatingRef.current = true;
    setCreating(true);
    try {
      const envelope = await createOrganizationRequest({
        name: trimmedName,
        slug: trimmedSlug || undefined,
      });
      if (!envelope.success) {
        setFieldErrors(apiErrorFieldMessages(envelope.error.details));
        setFormError({ message: envelope.error.message, code: envelope.error.code });
        return;
      }
      const created = envelope.data.organization;
      queryClient.setQueryData(organizationsQueryKey, (previous: typeof query.data) => {
        const list = previous ?? [];
        if (list.some((org) => org.id === created.id)) {
          return list;
        }
        return [created, ...list];
      });
      setCurrentOrganizationId(created.id);
      setName('');
      setSlug('');
      setSuccess('Organization created.');
      await queryClient.invalidateQueries({ queryKey: organizationsQueryKey });
      await queryClient.invalidateQueries({ queryKey: ['org'] });
    } catch (error) {
      setFormError({
        message: error instanceof Error ? error.message : 'Could not create the organization.',
      });
    } finally {
      creatingRef.current = false;
      setCreating(false);
    }
  }

  function selectOrganization(organizationId: string) {
    setCurrentOrganizationId(organizationId);
    void queryClient.invalidateQueries({ queryKey: ['org'] });
  }

  const organizations = query.data;
  const empty = query.isSuccess && (!organizations || organizations.length === 0);

  return (
    <div className="mx-auto w-full max-w-3xl">
      <h2 className="text-2xl font-semibold tracking-tight text-foreground">Organizations</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        List the organizations you belong to, create a new one, or select the current organization.
      </p>

      {query.isPending ? (
        <p className="mt-6 text-sm text-muted-foreground" role="status">
          Loading organizations.
        </p>
      ) : null}

      {query.isError ? (
        <div className="mt-6 flex flex-col gap-3">
          <p className="text-sm text-destructive" role="alert">
            Unable to load organizations.
          </p>
          <Button type="button" variant="outline" onClick={() => void query.refetch()}>
            Retry
          </Button>
        </div>
      ) : null}

      {empty ? (
        <p className="mt-6 text-sm text-muted-foreground">
          You do not belong to an organization yet. Create one to get started.
        </p>
      ) : null}

      {organizations && organizations.length > 0 ? (
        <ul className="mt-6 grid gap-3 sm:grid-cols-2">
          {organizations.map((org) => {
            const current = org.id === currentOrganizationId;
            return (
              <li key={org.id}>
                <article
                  data-testid={`org-card-${org.id}`}
                  className="rounded-lg border border-border bg-card p-4"
                >
                  <h3 className="text-base font-semibold text-foreground">{org.name}</h3>
                  {org.slug ? (
                    <p className="mt-1 text-xs text-muted-foreground">{org.slug}</p>
                  ) : null}
                  {current ? (
                    <p className="mt-3 text-sm font-medium text-primary">Current organization</p>
                  ) : (
                    <Button
                      type="button"
                      className="mt-3"
                      variant="outline"
                      onClick={() => selectOrganization(org.id)}
                    >
                      Select
                    </Button>
                  )}
                </article>
              </li>
            );
          })}
        </ul>
      ) : null}

      {query.isPending || query.isError ? null : (
        <form
          className="mt-8 flex max-w-[440px] flex-col gap-4"
          onSubmit={(event) => void onCreate(event)}
          noValidate
          data-testid="create-organization-form"
        >
          <h3 className="text-lg font-semibold text-foreground">Create organization</h3>
          {formError ? <AuthFormError message={formError.message} code={formError.code} /> : null}
          {success ? (
            <p data-testid="create-organization-success" className="text-sm text-foreground" role="status">
              {success}
            </p>
          ) : null}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="org-name">Name</Label>
            <Input
              id="org-name"
              name="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={creating}
              required
              aria-invalid={fieldErrors.name ? true : undefined}
            />
            {fieldErrors.name ? (
              <p className="text-xs text-destructive">{fieldErrors.name}</p>
            ) : null}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="org-slug">Slug (optional)</Label>
            <Input
              id="org-slug"
              name="slug"
              value={slug}
              onChange={(event) => setSlug(event.target.value)}
              disabled={creating}
              aria-invalid={fieldErrors.slug ? true : undefined}
            />
            {fieldErrors.slug ? (
              <p className="text-xs text-destructive">{fieldErrors.slug}</p>
            ) : null}
          </div>
          <Button type="submit" disabled={creating}>
            {creating ? 'Creating…' : 'Create organization'}
          </Button>
        </form>
      )}
    </div>
  );
}
