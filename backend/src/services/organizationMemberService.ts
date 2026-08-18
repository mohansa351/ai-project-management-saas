import type { OrgRole, Prisma, PrismaClient } from '@prisma/client';
import { AppError } from '../lib/http/appError.js';
import {
  AUTHZ_FORBIDDEN_MESSAGE,
  LAST_ACTIVE_ORG_ADMIN_ERROR,
  ORGANIZATION_NOT_FOUND_MESSAGE,
} from '../lib/http/orgErrors.js';
import type { OrganizationInviteRepository } from '../repositories/organizationInviteRepository.js';
import type {
  OrganizationMemberRepository,
  OrganizationMemberWithUser,
} from '../repositories/organizationMemberRepository.js';
import type { OrganizationRepository } from '../repositories/organizationRepository.js';
import { assertOrgMember, assertPermission } from './authz/assert.js';

export type PublicOrganizationMember = {
  id: string;
  organizationId: string;
  userId: string;
  role: OrgRole;
  status: OrganizationMemberWithUser['status'];
  createdAt: Date;
  updatedAt: Date;
  user: {
    id: string;
    email: string;
    name: string;
  };
};

export type ListMembersInput = {
  page: number;
  pageSize: number;
};

export type ListMembersResult = {
  members: PublicOrganizationMember[];
  meta: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
};

function notFound(): AppError {
  return new AppError('NOT_FOUND', ORGANIZATION_NOT_FOUND_MESSAGE, 404);
}

function forbidden(): AppError {
  return new AppError('AUTHZ_FORBIDDEN', AUTHZ_FORBIDDEN_MESSAGE, 403);
}

function lastActiveAdmin(): AppError {
  return new AppError(
    'VALIDATION_ERROR',
    LAST_ACTIVE_ORG_ADMIN_ERROR.message,
    400,
    LAST_ACTIVE_ORG_ADMIN_ERROR.details,
  );
}

export function toPublicMember(member: OrganizationMemberWithUser): PublicOrganizationMember {
  return {
    id: member.id,
    organizationId: member.organizationId,
    userId: member.userId,
    role: member.role,
    status: member.status,
    createdAt: member.createdAt,
    updatedAt: member.updatedAt,
    user: {
      id: member.user.id,
      email: member.user.email,
      name: member.user.name,
    },
  };
}

function dropsLastActiveAdminRole(member: OrganizationMemberWithUser, nextRole?: OrgRole): boolean {
  if (member.status !== 'ACTIVE' || member.role !== 'ORG_ADMIN') {
    return false;
  }
  return nextRole !== 'ORG_ADMIN';
}

export class OrganizationMemberService {
  constructor(
    private readonly organizationRepository: OrganizationRepository,
    private readonly organizationMemberRepository: OrganizationMemberRepository,
    private readonly inviteRepository: OrganizationInviteRepository,
    private readonly prisma: PrismaClient,
  ) {}

  async list(actorUserId: string, organizationId: string, input: ListMembersInput): Promise<ListMembersResult> {
    await this.requireMembersManage(actorUserId, organizationId);
    const { members, total } = await this.organizationMemberRepository.listByOrg({
      organizationId,
      page: input.page,
      pageSize: input.pageSize,
    });
    return {
      members: members.map(toPublicMember),
      meta: {
        page: input.page,
        pageSize: input.pageSize,
        total,
        totalPages: input.pageSize === 0 ? 0 : Math.ceil(total / input.pageSize),
      },
    };
  }

  async patchRole(
    actorUserId: string,
    organizationId: string,
    memberId: string,
    role: OrgRole,
  ): Promise<PublicOrganizationMember> {
    await this.requireMembersManage(actorUserId, organizationId);
    const updated = await this.prisma.$transaction(async (tx) => {
      await this.organizationMemberRepository.lockForMemberWrite(organizationId, tx);
      await this.requireMembersManage(actorUserId, organizationId, tx);
      const target = await this.requireMemberInOrg(organizationId, memberId, tx);
      if (dropsLastActiveAdminRole(target, role)) {
        const adminCount = await this.organizationMemberRepository.countActiveOrgAdmins(organizationId, tx);
        if (adminCount <= 1) {
          throw lastActiveAdmin();
        }
      }
      return this.organizationMemberRepository.updateRole(target.id, role, tx);
    });
    return toPublicMember(updated);
  }

  async remove(
    actorUserId: string,
    organizationId: string,
    memberId: string,
  ): Promise<PublicOrganizationMember> {
    await this.requireMembersManage(actorUserId, organizationId);
    const removed = await this.prisma.$transaction(async (tx) => {
      await this.organizationMemberRepository.lockForMemberWrite(organizationId, tx);
      await this.requireMembersManage(actorUserId, organizationId, tx);
      const target = await this.requireMemberInOrg(organizationId, memberId, tx);
      if (dropsLastActiveAdminRole(target)) {
        const adminCount = await this.organizationMemberRepository.countActiveOrgAdmins(organizationId, tx);
        if (adminCount <= 1) {
          throw lastActiveAdmin();
        }
      }
      await this.inviteRepository.expireUnusedForOrgEmail(
        organizationId,
        target.user.email.trim().toLowerCase(),
        tx,
      );
      await this.organizationMemberRepository.deleteById(target.id, tx);
      return target;
    });
    return toPublicMember(removed);
  }

  private async requireMembersManage(
    userId: string,
    organizationId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    if (!tx) {
      const { member } = await assertOrgMember(
        {
          organizationRepository: this.organizationRepository,
          organizationMemberRepository: this.organizationMemberRepository,
        },
        userId,
        organizationId,
      );
      assertPermission(member.role, 'org.members.manage');
      return;
    }
    const organization = await this.organizationRepository.findLiveById(organizationId, tx);
    if (!organization) {
      throw notFound();
    }
    const member = await this.organizationMemberRepository.findActiveByOrgAndUser(
      organizationId,
      userId,
      tx,
    );
    if (!member) {
      throw forbidden();
    }
    assertPermission(member.role, 'org.members.manage');
  }

  private async requireMemberInOrg(
    organizationId: string,
    memberId: string,
    tx: Prisma.TransactionClient,
  ): Promise<OrganizationMemberWithUser> {
    const target = await this.organizationMemberRepository.findById(memberId, tx);
    if (!target || target.organizationId !== organizationId) {
      throw notFound();
    }
    return target;
  }
}
