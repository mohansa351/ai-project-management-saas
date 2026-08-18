import type { OrganizationInvite, OrgRole, PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';
import type { EmailProvider } from '../lib/email/emailProvider.js';
import { AppError } from '../lib/http/appError.js';
import {
  ALREADY_ACTIVE_MEMBER_ERROR,
  AUTHZ_FORBIDDEN_MESSAGE,
  ORGANIZATION_NOT_FOUND_MESSAGE,
  ORG_INVITE_TOKEN_INVALID_MESSAGE,
} from '../lib/http/orgErrors.js';
import { logger } from '../lib/logger.js';
import { generateToken, hashToken } from '../lib/token.js';
import type { OrganizationInviteRepository } from '../repositories/organizationInviteRepository.js';
import type { OrganizationMemberRepository } from '../repositories/organizationMemberRepository.js';
import type { OrganizationRepository } from '../repositories/organizationRepository.js';
import type { UserRepository } from '../repositories/userRepository.js';
import { assertOrgMember, assertPermission } from './authz/assert.js';

export type PublicOrganizationInvite = {
  id: string;
  organizationId: string;
  email: string;
  role: OrgRole;
  expiresAt: Date;
  createdAt: Date;
};

export type PublicInviteMembership = {
  organizationId: string;
  role: OrgRole;
  status: 'ACTIVE';
};

export type InviteMemberInput = {
  email: string;
  role: OrgRole;
};

function forbidden(): AppError {
  return new AppError('AUTHZ_FORBIDDEN', AUTHZ_FORBIDDEN_MESSAGE, 403);
}

function invalidInviteToken(): AppError {
  return new AppError('AUTH_TOKEN_INVALID', ORG_INVITE_TOKEN_INVALID_MESSAGE, 400);
}

function alreadyActive(): AppError {
  return new AppError(
    'VALIDATION_ERROR',
    ALREADY_ACTIVE_MEMBER_ERROR.message,
    400,
    ALREADY_ACTIVE_MEMBER_ERROR.details,
  );
}

function notFound(): AppError {
  return new AppError('NOT_FOUND', ORGANIZATION_NOT_FOUND_MESSAGE, 404);
}

export function toPublicInvite(invite: OrganizationInvite): PublicOrganizationInvite {
  return {
    id: invite.id,
    organizationId: invite.organizationId,
    email: invite.email,
    role: invite.role,
    expiresAt: invite.expiresAt,
    createdAt: invite.createdAt,
  };
}

export class OrganizationInviteService {
  constructor(
    private readonly organizationRepository: OrganizationRepository,
    private readonly organizationMemberRepository: OrganizationMemberRepository,
    private readonly inviteRepository: OrganizationInviteRepository,
    private readonly userRepository: UserRepository,
    private readonly emailProvider: EmailProvider,
    private readonly prisma: PrismaClient,
  ) {}

  async invite(
    actorUserId: string,
    organizationId: string,
    input: InviteMemberInput,
  ): Promise<PublicOrganizationInvite> {
    const { member } = await assertOrgMember(
      {
        organizationRepository: this.organizationRepository,
        organizationMemberRepository: this.organizationMemberRepository,
      },
      actorUserId,
      organizationId,
    );
    assertPermission(member.role, 'org.invite');

    const email = input.email.trim().toLowerCase();
    const invitee = await this.userRepository.findByEmail(email);

    const rawToken = generateToken();
    const expiresAt = new Date(Date.now() + env.ORG_INVITE_TOKEN_TTL_MINUTES * 60_000);

    const invite = await this.prisma.$transaction(async (tx) => {
      await this.inviteRepository.lockForIssuance(organizationId, email, tx);
      if (invitee) {
        const existing = await this.organizationMemberRepository.findByOrgAndUser(
          organizationId,
          invitee.id,
          tx,
        );
        if (existing?.status === 'ACTIVE') {
          throw alreadyActive();
        }
      }
      await this.inviteRepository.expireUnusedForOrgEmail(organizationId, email, tx);
      const created = await this.inviteRepository.create(
        {
          organizationId,
          email,
          role: input.role,
          tokenHash: hashToken(rawToken),
          expiresAt,
        },
        tx,
      );
      if (invitee) {
        await this.organizationMemberRepository.upsertPending(
          organizationId,
          invitee.id,
          input.role,
          tx,
        );
      }
      return created;
    });

    const link = `${env.CORS_ORIGIN}/accept-invite?organizationId=${encodeURIComponent(organizationId)}&token=${encodeURIComponent(rawToken)}`;
    await this.emailProvider
      .send({
        to: email,
        subject: 'You have been invited to an organization',
        body: `Accept this invitation by opening this link:\n${link}`,
        html: `<p>Accept this invitation by clicking <a href="${link}">this invite link</a>.</p>`,
        type: 'organization_invite',
      })
      .catch((err) => {
        logger.warn({ err }, 'organization invite email failed');
      });

    return toPublicInvite(invite);
  }

  async accept(
    actor: { id: string; email: string },
    organizationId: string,
    rawToken: string,
  ): Promise<PublicInviteMembership> {
    const tokenHash = hashToken(rawToken);

    return this.prisma.$transaction(async (tx) => {
      const organization = await this.organizationRepository.findLiveById(organizationId, tx);
      if (!organization) {
        throw notFound();
      }
      const invite = await this.inviteRepository.findValidByHash(tokenHash, tx);
      if (!invite || invite.organizationId !== organizationId) {
        throw invalidInviteToken();
      }
      if (invite.email !== actor.email.trim().toLowerCase()) {
        throw forbidden();
      }

      const claimed = await this.inviteRepository.markAcceptedIfActive(invite.id, tx);
      if (claimed !== 1) {
        throw invalidInviteToken();
      }

      const member = await this.organizationMemberRepository.activate(
        organizationId,
        actor.id,
        invite.role,
        tx,
      );
      return {
        organizationId: member.organizationId,
        role: member.role,
        status: 'ACTIVE' as const,
      };
    });
  }
}
