import type { Prisma, PrismaClient, Project, ProjectPriority, ProjectStatus } from '@prisma/client';
import { projectSoftDeleteCascade } from './projectSoftDeleteCascade.js';

type PrismaClientOrTx = PrismaClient | Prisma.TransactionClient;

export type CreateProjectRecordInput = {
  organizationId: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  priority: ProjectPriority;
  startDate: Date | null;
  dueDate: Date | null;
  ownerId: string;
};

export type UpdateLiveProjectInput = {
  name?: string;
  description?: string | null;
  status?: ProjectStatus;
  priority?: ProjectPriority;
  startDate?: Date | null;
  dueDate?: Date | null;
  ownerId?: string;
};

export type ListLiveProjectsQuery = {
  organizationId: string;
  page: number;
  pageSize: number;
  status?: ProjectStatus;
  userId?: string;
};

export type ListLiveProjectsResult = {
  projects: Project[];
  total: number;
};

function liveListWhere(query: ListLiveProjectsQuery): Prisma.ProjectWhereInput {
  const where: Prisma.ProjectWhereInput = {
    organizationId: query.organizationId,
    deletedAt: null,
    ...(query.status ? { status: query.status } : { status: { not: 'ARCHIVED' } }),
  };
  if (query.userId) {
    where.members = { some: { userId: query.userId } };
  }
  return where;
}

export class ProjectRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreateProjectRecordInput, client: PrismaClientOrTx = this.prisma): Promise<Project> {
    return client.project.create({
      data: {
        organizationId: input.organizationId,
        name: input.name,
        description: input.description,
        status: input.status,
        priority: input.priority,
        startDate: input.startDate,
        dueDate: input.dueDate,
        ownerId: input.ownerId,
      },
    });
  }

  async findLiveById(id: string, client: PrismaClientOrTx = this.prisma): Promise<Project | null> {
    return client.project.findFirst({
      where: { id, deletedAt: null },
    });
  }

  async listLiveForOrg(
    query: Omit<ListLiveProjectsQuery, 'userId'>,
    client: PrismaClientOrTx = this.prisma,
  ): Promise<ListLiveProjectsResult> {
    return this.listLive({ ...query }, client);
  }

  async listLiveForMember(
    query: ListLiveProjectsQuery & { userId: string },
    client: PrismaClientOrTx = this.prisma,
  ): Promise<ListLiveProjectsResult> {
    return this.listLive(query, client);
  }

  private async listLive(
    query: ListLiveProjectsQuery,
    client: PrismaClientOrTx,
  ): Promise<ListLiveProjectsResult> {
    const where = liveListWhere(query);
    const skip = (query.page - 1) * query.pageSize;
    const [projects, total] = await Promise.all([
      client.project.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take: query.pageSize,
      }),
      client.project.count({ where }),
    ]);
    return { projects, total };
  }

  async updateLive(
    id: string,
    input: UpdateLiveProjectInput,
    client: PrismaClientOrTx = this.prisma,
  ): Promise<Project | null> {
    const result = await client.project.updateMany({
      where: { id, deletedAt: null },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        ...(input.startDate !== undefined ? { startDate: input.startDate } : {}),
        ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
        ...(input.ownerId !== undefined ? { ownerId: input.ownerId } : {}),
      },
    });
    if (result.count === 0) {
      return null;
    }
    return this.findLiveById(id, client);
  }

  async softDelete(id: string, client: PrismaClientOrTx = this.prisma): Promise<Project | null> {
    const result = await client.project.updateMany({
      where: { id, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (result.count === 0) {
      return null;
    }
    await projectSoftDeleteCascade.cascadeProjectSoftDeleteChildren(client, id);
    return client.project.findFirst({ where: { id } });
  }
}
