import type { OrganizationInvite, OrgRole, Prisma, PrismaClient } from '@prisma/client';

export type CreateOrganizationInviteInput = {
  organizationId: string;
  email: string;
  role: OrgRole;
  tokenHash: string;
  expiresAt: Date;
};

type PrismaClientOrTx = PrismaClient | Prisma.TransactionClient;

export class OrganizationInviteRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(
    input: CreateOrganizationInviteInput,
    client: PrismaClientOrTx = this.prisma,
  ): Promise<OrganizationInvite> {
    return client.organizationInvite.create({
      data: {
        organizationId: input.organizationId,
        email: input.email,
        role: input.role,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
      },
    });
  }

  async findValidByHash(
    tokenHash: string,
    client: PrismaClientOrTx = this.prisma,
  ): Promise<OrganizationInvite | null> {
    const row = await client.organizationInvite.findUnique({
      where: { tokenHash },
    });
    if (!row || row.acceptedAt !== null || row.expiresAt <= new Date()) {
      return null;
    }
    return row;
  }

  /** Expire unused live invites for the same org+email so only the next create is live. */
  async expireUnusedForOrgEmail(
    organizationId: string,
    email: string,
    client: PrismaClientOrTx = this.prisma,
  ): Promise<void> {
    await client.organizationInvite.updateMany({
      where: {
        organizationId,
        email,
        acceptedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { expiresAt: new Date() },
    });
  }

  async markAcceptedIfActive(id: string, client: PrismaClientOrTx = this.prisma): Promise<number> {
    const result = await client.organizationInvite.updateMany({
      where: { id, acceptedAt: null, expiresAt: { gt: new Date() } },
      data: { acceptedAt: new Date() },
    });
    return result.count;
  }

  /**
   * Serializes invite issuance for the same organization+email so concurrent re-invites
   * cannot both observe "no live token" under READ COMMITTED.
   */
  async lockForIssuance(
    organizationId: string,
    email: string,
    client: PrismaClientOrTx = this.prisma,
  ): Promise<void> {
    const key = `${organizationId}:${email}`;
    await client.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
  }
}
