import type { OrganizationMember, Prisma, PrismaClient } from '@prisma/client';
import { AppError } from '../lib/http/appError.js';

type PrismaClientOrTx = PrismaClient | Prisma.TransactionClient;

function isUniqueConstraint(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === 'P2002'
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
}
