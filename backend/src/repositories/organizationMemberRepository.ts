import type { OrganizationMember, OrgRole, Prisma, PrismaClient } from '@prisma/client';
import { AppError } from '../lib/http/appError.js';
import { ALREADY_ACTIVE_MEMBER_ERROR } from '../lib/http/orgErrors.js';

type PrismaClientOrTx = PrismaClient | Prisma.TransactionClient;

const memberUserSelect = { id: true, email: true, name: true } as const;

export type OrganizationMemberWithUser = OrganizationMember & {
  user: { id: string; email: string; name: string };
};

export type ListByOrgQuery = {
  organizationId: string;
  page: number;
  pageSize: number;
};

export type ListByOrgResult = {
  members: OrganizationMemberWithUser[];
  total: number;
};

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

  /**
   * Serializes last-admin counts with the following write so concurrent demote/remove
   * cannot both observe more than one ACTIVE ORG_ADMIN under READ COMMITTED.
   */
  async lockForMemberWrite(organizationId: string, client: PrismaClientOrTx = this.prisma): Promise<void> {
    const key = `org-members:${organizationId}`;
    await client.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
  }

  async findById(
    id: string,
    client: PrismaClientOrTx = this.prisma,
  ): Promise<OrganizationMemberWithUser | null> {
    return client.organizationMember.findUnique({
      where: { id },
      include: { user: { select: memberUserSelect } },
    });
  }

  async listByOrg(query: ListByOrgQuery, client: PrismaClientOrTx = this.prisma): Promise<ListByOrgResult> {
    const where: Prisma.OrganizationMemberWhereInput = { organizationId: query.organizationId };
    const skip = (query.page - 1) * query.pageSize;
    const [members, total] = await Promise.all([
      client.organizationMember.findMany({
        where,
        include: { user: { select: memberUserSelect } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take: query.pageSize,
      }),
      client.organizationMember.count({ where }),
    ]);
    return { members, total };
  }

  async countActiveOrgAdmins(
    organizationId: string,
    client: PrismaClientOrTx = this.prisma,
  ): Promise<number> {
    return client.organizationMember.count({
      where: {
        organizationId,
        role: 'ORG_ADMIN',
        status: 'ACTIVE',
      },
    });
  }

  async updateRole(
    id: string,
    role: OrgRole,
    client: PrismaClientOrTx = this.prisma,
  ): Promise<OrganizationMemberWithUser> {
    return client.organizationMember.update({
      where: { id },
      data: { role },
      include: { user: { select: memberUserSelect } },
    });
  }

  async deleteById(id: string, client: PrismaClientOrTx = this.prisma): Promise<void> {
    await client.organizationMember.delete({ where: { id } });
  }
}
