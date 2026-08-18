'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiErrorFieldMessages } from '@/features/auth/api-errors';
import { AuthFormError } from '@/features/auth/components/auth-card';
import { useSessionStore } from '@/features/auth/session-store';
import {
  inviteMemberRequest,
  isCurrentOrgAdmin,
  listMembersRequest,
  organizationsQueryKey,
  orgQueryKey,
  patchMemberRoleRequest,
  removeMemberRequest,
  type OrgRole,
  type PublicOrganizationMember,
} from '@/features/organizations/org-api';
import { useOrganizationsQuery } from '@/features/organizations/use-organizations-query';

const ROLE_OPTIONS: Array<{ value: OrgRole; label: string }> = [
  { value: 'ORG_ADMIN', label: 'Org Admin' },
  { value: 'PROJECT_MANAGER', label: 'Project Manager' },
  { value: 'TEAM_MEMBER', label: 'Team Member' },
];

type DialogState =
  | { type: 'invite' }
  | { type: 'remove'; member: PublicOrganizationMember }
  | null;

export function MembersSettingsPage() {
  const queryClient = useQueryClient();
  const currentOrganizationId = useSessionStore((s) => s.currentOrganizationId);
  const organizationsQuery = useOrganizationsQuery();
  const isAdmin = isCurrentOrgAdmin(organizationsQuery.data, currentOrganizationId);

  const membersQuery = useQuery({
    queryKey: orgQueryKey(currentOrganizationId ?? '', 'members'),
    enabled: Boolean(currentOrganizationId) && isAdmin,
    queryFn: async () => {
      const envelope = await listMembersRequest(currentOrganizationId as string);
      if (!envelope.success) {
        throw new Error(envelope.error.message);
      }
      return envelope.data.members;
    },
  });

  const [dialog, setDialog] = useState<DialogState>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<OrgRole>('TEAM_MEMBER');
  const [inviteFields, setInviteFields] = useState<Record<string, string>>({});
  const [pageError, setPageError] = useState<{ message: string; code?: string } | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    setDialog(null);
    setPageError(null);
    setSuccess(null);
  }, [currentOrganizationId]);

  const mutating = useMutation({
    mutationFn: async (
      action:
        | { type: 'invite'; email: string; role: OrgRole }
        | { type: 'role'; memberId: string; role: OrgRole }
        | { type: 'remove'; memberId: string },
    ) => {
      const organizationId = currentOrganizationId as string;
      if (action.type === 'invite') {
        return inviteMemberRequest(organizationId, { email: action.email, role: action.role });
      }
      if (action.type === 'role') {
        return patchMemberRoleRequest(organizationId, action.memberId, action.role);
      }
      return removeMemberRequest(organizationId, action.memberId);
    },
    onSuccess: async (envelope, action) => {
      if (!envelope.success) {
        setInviteFields(apiErrorFieldMessages(envelope.error.details));
        setPageError({ message: envelope.error.message, code: envelope.error.code });
        return;
      }
      setPageError(null);
      setInviteFields({});
      if (action.type === 'invite') {
        setSuccess('Invite sent.');
        setInviteEmail('');
        setInviteRole('TEAM_MEMBER');
        setDialog(null);
      } else if (action.type === 'role') {
        setSuccess('Member role updated.');
      } else {
        setSuccess('Member removed.');
        setDialog(null);
      }
      await queryClient.invalidateQueries({
        queryKey: orgQueryKey(currentOrganizationId ?? '', 'members'),
      });
      if (action.type === 'remove') {
        await queryClient.invalidateQueries({ queryKey: organizationsQueryKey });
      }
    },
    onError: (error: Error) => {
      setPageError({ message: error.message });
    },
  });

  const busy = mutating.isPending;

  async function onInvite(event: FormEvent) {
    event.preventDefault();
    setPageError(null);
    setSuccess(null);
    const email = inviteEmail.trim();
    if (!email) {
      setInviteFields({ email: 'Email is required.' });
      return;
    }
    setInviteFields({});
    await mutating.mutateAsync({ type: 'invite', email, role: inviteRole });
  }

  if (!currentOrganizationId) {
    return (
      <div className="mx-auto max-w-[440px]">
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">Members</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Select an organization before managing members.{' '}
          <Link className="text-primary underline-offset-4 hover:underline" href="/organizations">
            Go to Organizations
          </Link>
        </p>
      </div>
    );
  }

  if (organizationsQuery.isPending) {
    return (
      <div className="mx-auto max-w-3xl">
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">Members</h2>
        <p className="mt-6 text-sm text-muted-foreground" role="status">
          Loading organizations.
        </p>
      </div>
    );
  }

  if (organizationsQuery.isError) {
    return (
      <div className="mx-auto max-w-3xl">
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">Members</h2>
        <div className="mt-6 flex flex-col gap-3">
          <p className="text-sm text-destructive" role="alert">
            Unable to load organizations.
          </p>
          <Button type="button" variant="outline" onClick={() => void organizationsQuery.refetch()}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  const currentOrg = organizationsQuery.data?.find((org) => org.id === currentOrganizationId);
  if (!currentOrg) {
    return (
      <div className="mx-auto max-w-[440px]">
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">Members</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Select an organization before managing members.{' '}
          <Link className="text-primary underline-offset-4 hover:underline" href="/organizations">
            Go to Organizations
          </Link>
        </p>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-[440px]" data-testid="members-forbidden">
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">Forbidden</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          You do not have permission to manage members for this organization.
        </p>
      </div>
    );
  }

  const members = membersQuery.data ?? [];
  const empty = membersQuery.isSuccess && members.length === 0;

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">Members</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Invite people, change roles, and remove members of the current organization.
          </p>
        </div>
        <Button
          type="button"
          onClick={() => {
            if (dialog) {
              return;
            }
            setPageError(null);
            setSuccess(null);
            setDialog({ type: 'invite' });
          }}
          disabled={busy || dialog !== null}
        >
          Invite member
        </Button>
      </div>

      {pageError && dialog === null ? (
        <div className="mt-4">
          <AuthFormError message={pageError.message} code={pageError.code} />
        </div>
      ) : null}
      {success ? (
        <p data-testid="members-success" className="mt-4 text-sm text-foreground" role="status">
          {success}
        </p>
      ) : null}

      {membersQuery.isPending ? (
        <p className="mt-6 text-sm text-muted-foreground" role="status">
          Loading members.
        </p>
      ) : null}

      {membersQuery.isError ? (
        <div className="mt-6 flex flex-col gap-3">
          <p className="text-sm text-destructive" role="alert">
            Unable to load members.
          </p>
          <Button type="button" variant="outline" onClick={() => void membersQuery.refetch()}>
            Retry
          </Button>
        </div>
      ) : null}

      {empty ? (
        <p className="mt-6 text-sm text-muted-foreground">
          This organization has no members to show yet.
        </p>
      ) : null}

      {members.length > 0 ? (
        <ul className="mt-6 divide-y divide-border rounded-lg border border-border bg-card">
          {members.map((member) => (
            <li
              key={member.id}
              data-testid={`member-row-${member.id}`}
              className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <p className="text-sm font-medium text-foreground">{member.user.name}</p>
                <p className="text-xs text-muted-foreground">{member.user.email}</p>
                <p className="mt-1 text-xs text-muted-foreground">{member.status}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-xs text-muted-foreground">
                  Role
                  <select
                    aria-label={`Role for ${member.user.name}`}
                    className="ml-2 h-9 rounded-md border border-input bg-card px-2 text-sm text-foreground"
                    value={member.role}
                    disabled={busy || dialog !== null}
                    onChange={(event) => {
                      setPageError(null);
                      setSuccess(null);
                      void mutating.mutateAsync({
                        type: 'role',
                        memberId: member.id,
                        role: event.target.value as OrgRole,
                      });
                    }}
                  >
                    {ROLE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={busy || dialog !== null}
                  onClick={() => {
                    if (dialog) {
                      return;
                    }
                    setPageError(null);
                    setSuccess(null);
                    setDialog({ type: 'remove', member });
                  }}
                >
                  Remove
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      <Dialog
        open={dialog?.type === 'invite'}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setDialog(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite member</DialogTitle>
            <DialogDescription>
              Send an invitation by email. Unknown addresses will not appear on the roster until
              the person registers and accepts.
            </DialogDescription>
          </DialogHeader>
          {pageError && dialog?.type === 'invite' ? (
            <div className="mt-4">
              <AuthFormError message={pageError.message} code={pageError.code} />
            </div>
          ) : null}
          <form className="mt-4 flex flex-col gap-4" onSubmit={(event) => void onInvite(event)}>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="invite-email">Email</Label>
              <Input
                id="invite-email"
                type="email"
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
                disabled={busy}
                required
                aria-invalid={inviteFields.email ? true : undefined}
                aria-describedby={inviteFields.email ? 'invite-email-error' : undefined}
              />
              {inviteFields.email ? (
                <p id="invite-email-error" className="text-xs text-destructive">{inviteFields.email}</p>
              ) : null}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="invite-role">Role</Label>
              <select
                id="invite-role"
                className="h-9 rounded-md border border-input bg-card px-2 text-sm text-foreground"
                value={inviteRole}
                disabled={busy}
                onChange={(event) => setInviteRole(event.target.value as OrgRole)}
              >
                {ROLE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => setDialog(null)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? 'Sending…' : 'Send invite'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={dialog?.type === 'remove'}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setDialog(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove member</DialogTitle>
            <DialogDescription>
              {dialog?.type === 'remove'
                ? `Remove ${dialog.member.user.name} from this organization? They will lose access immediately.`
                : 'Remove this member from the organization?'}
            </DialogDescription>
          </DialogHeader>
          {pageError && dialog?.type === 'remove' ? (
            <div className="mt-4">
              <AuthFormError message={pageError.message} code={pageError.code} />
            </div>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => setDialog(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={busy}
              onClick={() => {
                if (dialog?.type !== 'remove') {
                  return;
                }
                void mutating.mutateAsync({ type: 'remove', memberId: dialog.member.id });
              }}
            >
              {busy ? 'Removing…' : 'Remove member'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
