import type { Prisma, PrismaClient, ProjectMember } from '@prisma/client';

type PrismaClientOrTx = PrismaClient | Prisma.TransactionClient;

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
}
