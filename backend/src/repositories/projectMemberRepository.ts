import type { Prisma, PrismaClient, ProjectMember } from '@prisma/client';
import { AppError } from '../lib/http/appError.js';
import { DUPLICATE_PROJECT_MEMBER_ERROR, PROJECT_MEMBER_NOT_FOUND_MESSAGE } from '../lib/http/projectErrors.js';

type PrismaClientOrTx = PrismaClient | Prisma.TransactionClient;

const memberUserSelect = { id: true, email: true, name: true } as const;

export type ProjectMemberWithUser = ProjectMember & {
  user: { id: string; email: string; name: string };
};

export type ListByProjectQuery = {
  projectId: string;
  page: number;
  pageSize: number;
};

export type ListByProjectResult = {
  members: ProjectMemberWithUser[];
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

function isRecordNotFound(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === 'P2025'
  );
}

function duplicateMember(): AppError {
  return new AppError(
    'VALIDATION_ERROR',
    DUPLICATE_PROJECT_MEMBER_ERROR.message,
    400,
    DUPLICATE_PROJECT_MEMBER_ERROR.details,
  );
}

function memberNotFound(): AppError {
  return new AppError('NOT_FOUND', PROJECT_MEMBER_NOT_FOUND_MESSAGE, 404);
}

export class ProjectMemberRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async upsertForUser(
    projectId: string,
    userId: string,
    client: PrismaClientOrTx = this.prisma,
  ): Promise<ProjectMember> {
    return client.projectMember.upsert({
      where: { projectId_userId: { projectId, userId } },
      create: { projectId, userId },
      update: {},
    });
  }

  async findByProjectAndUser(
    projectId: string,
    userId: string,
    client: PrismaClientOrTx = this.prisma,
  ): Promise<ProjectMember | null> {
    return client.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId } },
    });
  }

  async findById(
    id: string,
    client: PrismaClientOrTx = this.prisma,
  ): Promise<ProjectMemberWithUser | null> {
    return client.projectMember.findUnique({
      where: { id },
      include: { user: { select: memberUserSelect } },
    });
  }

  async listByProject(
    query: ListByProjectQuery,
    client: PrismaClientOrTx = this.prisma,
  ): Promise<ListByProjectResult> {
    const where: Prisma.ProjectMemberWhereInput = { projectId: query.projectId };
    const skip = (query.page - 1) * query.pageSize;
    const [members, total] = await Promise.all([
      client.projectMember.findMany({
        where,
        include: { user: { select: memberUserSelect } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take: query.pageSize,
      }),
      client.projectMember.count({ where }),
    ]);
    return { members, total };
  }

  async createForUser(
    projectId: string,
    userId: string,
    client: PrismaClientOrTx = this.prisma,
  ): Promise<ProjectMemberWithUser> {
    try {
      return await client.projectMember.create({
        data: { projectId, userId },
        include: { user: { select: memberUserSelect } },
      });
    } catch (err) {
      if (isUniqueConstraint(err)) {
        throw duplicateMember();
      }
      throw err;
    }
  }

  async deleteById(id: string, client: PrismaClientOrTx = this.prisma): Promise<void> {
    try {
      await client.projectMember.delete({ where: { id } });
    } catch (err) {
      if (isRecordNotFound(err)) {
        throw memberNotFound();
      }
      throw err;
    }
  }
}
