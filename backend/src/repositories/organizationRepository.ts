import type { Organization, Prisma, PrismaClient } from '@prisma/client';
import { AppError } from '../lib/http/appError.js';
import { SLUG_TAKEN_ERROR } from '../lib/http/orgErrors.js';

export type CreateOrganizationInput = {
  name: string;
  slug?: string;
};

export type UpdateLiveOrganizationInput = {
  name?: string;
  slug?: string;
};

export type ListLiveForUserQuery = {
  userId: string;
  page: number;
  pageSize: number;
};

export type ListLiveForUserResult = {
  organizations: Organization[];
  total: number;
};

type PrismaClientOrTx = PrismaClient | Prisma.TransactionClient;

function isUniqueConstraint(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === 'P2002'
  );
}

function slugTaken(): AppError {
  return new AppError('VALIDATION_ERROR', SLUG_TAKEN_ERROR.message, 400, SLUG_TAKEN_ERROR.details);
}

export class OrganizationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreateOrganizationInput, client: PrismaClientOrTx = this.prisma): Promise<Organization> {
    try {
      return await client.organization.create({
        data: {
          name: input.name,
          slug: input.slug,
        },
      });
    } catch (err) {
      if (isUniqueConstraint(err)) {
        throw slugTaken();
      }
      throw err;
    }
  }

  async findLiveById(id: string, client: PrismaClientOrTx = this.prisma): Promise<Organization | null> {
    return client.organization.findFirst({
      where: { id, deletedAt: null },
    });
  }

  async listLiveForUser(
    query: ListLiveForUserQuery,
    client: PrismaClientOrTx = this.prisma,
  ): Promise<ListLiveForUserResult> {
    const where: Prisma.OrganizationWhereInput = {
      deletedAt: null,
      members: {
        some: {
          userId: query.userId,
          status: 'ACTIVE',
        },
      },
    };
    const skip = (query.page - 1) * query.pageSize;
    const [organizations, total] = await Promise.all([
      client.organization.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take: query.pageSize,
      }),
      client.organization.count({ where }),
    ]);
    return { organizations, total };
  }

  async updateLive(
    id: string,
    input: UpdateLiveOrganizationInput,
    client: PrismaClientOrTx = this.prisma,
  ): Promise<Organization | null> {
    try {
      const result = await client.organization.updateMany({
        where: { id, deletedAt: null },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.slug !== undefined ? { slug: input.slug } : {}),
        },
      });
      if (result.count === 0) {
        return null;
      }
      return this.findLiveById(id, client);
    } catch (err) {
      if (isUniqueConstraint(err)) {
        throw slugTaken();
      }
      throw err;
    }
  }

  async softDelete(id: string, client: PrismaClientOrTx = this.prisma): Promise<Organization | null> {
    const result = await client.organization.updateMany({
      where: { id, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (result.count === 0) {
      return null;
    }
    return client.organization.findFirst({ where: { id } });
  }
}
