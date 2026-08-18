import type { OrganizationMember, Prisma, PrismaClient } from '@prisma/client';
import { AppError } from '../lib/http/appError.js';
import { ALREADY_ACTIVE_MEMBER_ERROR } from '../lib/http/orgErrors.js';

type PrismaClientOrTx = PrismaClient | Prisma.TransactionClient;

function isUniqueConstraint(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === 'P2002'
  );
}

function alreadyActiveMember(): AppError {
  return new AppError(
    'VALIDATION_ERROR',
    ALREADY_ACTIVE_MEMBER_ERROR.message,
    400,
    ALREADY_ACTIVE_MEMBER_ERROR.details,
  );
}

export class OrganizationMemberRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async upsertOrgAdmin(
    organizationId: string,
    userId: string,
    client: PrismaClientOrTx = this.prisma,
  ): Promise<OrganizationMember> {
    try {
      return await client.organizationMember.upsert({
        where: {
          organizationId_userId: { organizationId, userId },
        },
        create: {
          organizationId,
          userId,
          role: 'ORG_ADMIN',
          status: 'ACTIVE',
        },
        update: {
          role: 'ORG_ADMIN',
          status: 'ACTIVE',
        },
      });
    } catch (err) {
      if (isUniqueConstraint(err)) {
        throw new AppError('VALIDATION_ERROR', 'Validation failed', 400, {
          userId: ['Member already exists for this organization'],
        });
      }
      throw err;
    }
  }

  async findActiveByOrgAndUser(
    organizationId: string,
    userId: string,
    client: PrismaClientOrTx = this.prisma,
  ): Promise<OrganizationMember | null> {
    return client.organizationMember.findFirst({
      where: {
        organizationId,
        userId,
        status: 'ACTIVE',
      },
    });
  }

  async findByOrgAndUser(
    organizationId: string,
    userId: string,
    client: PrismaClientOrTx = this.prisma,
  ): Promise<OrganizationMember | null> {
    return client.organizationMember.findFirst({
      where: { organizationId, userId },
    });
  }

  async upsertPending(
    organizationId: string,
    userId: string,
    role: OrganizationMember['role'],
    client: PrismaClientOrTx = this.prisma,
  ): Promise<OrganizationMember> {
    const existing = await this.findByOrgAndUser(organizationId, userId, client);
    if (existing?.status === 'ACTIVE') {
      throw alreadyActiveMember();
    }
    if (!existing) {
      return client.organizationMember.create({
        data: {
          organizationId,
          userId,
          role,
          status: 'PENDING',
        },
      });
    }
    const result = await client.organizationMember.updateMany({
      where: { organizationId, userId, status: { not: 'ACTIVE' } },
      data: { role, status: 'PENDING' },
    });
    if (result.count !== 1) {
      throw alreadyActiveMember();
    }
    const updated = await this.findByOrgAndUser(organizationId, userId, client);
    if (!updated || updated.status === 'ACTIVE') {
      throw alreadyActiveMember();
    }
    return updated;
  }

  async activate(
    organizationId: string,
    userId: string,
    role: OrganizationMember['role'],
    client: PrismaClientOrTx = this.prisma,
  ): Promise<OrganizationMember> {
    return client.organizationMember.upsert({
      where: { organizationId_userId: { organizationId, userId } },
      create: {
        organizationId,
        userId,
        role,
        status: 'ACTIVE',
      },
      update: {
        role,
        status: 'ACTIVE',
      },
    });
  }
}
