import type { Prisma, PrismaClient, RefreshToken } from '@prisma/client';

export type CreateRefreshTokenInput = {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  userAgent?: string;
  replacedByHash?: string | null;
};

type PrismaClientOrTx = PrismaClient | Prisma.TransactionClient;

export class RefreshTokenRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreateRefreshTokenInput, client: PrismaClientOrTx = this.prisma): Promise<RefreshToken> {
    return client.refreshToken.create({
      data: {
        userId: input.userId,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
        userAgent: input.userAgent,
        replacedByHash: input.replacedByHash ?? null,
      },
    });
  }

  async findByHash(tokenHash: string, client: PrismaClientOrTx = this.prisma): Promise<RefreshToken | null> {
    return client.refreshToken.findUnique({ where: { tokenHash } });
  }

  /**
   * Transaction-scoped lock on this token hash (not userId) so two devices can refresh
   * independently. Auto-released at commit/rollback.
   */
  async lockForRotation(tokenHash: string, client: PrismaClientOrTx = this.prisma): Promise<void> {
    await client.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${tokenHash}))`;
  }

  /** Atomically claims a live unexpired hash for rotation. Returns 1 if this worker won. */
  async claimRotation(
    tokenHash: string,
    successorHash: string,
    client: PrismaClientOrTx = this.prisma,
  ): Promise<number> {
    const result = await client.refreshToken.updateMany({
      where: {
        tokenHash,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: {
        revokedAt: new Date(),
        replacedByHash: successorHash,
      },
    });
    return result.count;
  }

  /** Revokes a live (unrevoked, unexpired) row by hash. Returns rows updated (0 or 1). */
  async revokeByHash(tokenHash: string, client: PrismaClientOrTx = this.prisma): Promise<number> {
    const result = await client.refreshToken.updateMany({
      where: {
        tokenHash,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { revokedAt: new Date() },
    });
    return result.count;
  }

  /**
   * Walks replacedByHash from `start` and revokes the first live leaf if a successor
   * in the chain was itself rotated (proven ancestor replay). Does not touch other user rows.
   */
  async revokeLiveLeafOfChain(start: RefreshToken, client: PrismaClientOrTx = this.prisma): Promise<string | null> {
    let current: RefreshToken | null = start;
    let foundRotatedSuccessor = false;
    let liveLeafHash: string | null = null;

    while (current?.replacedByHash) {
      const next: RefreshToken | null = await this.findByHash(current.replacedByHash, client);
      if (!next) {
        break;
      }
      if (next.replacedByHash) {
        foundRotatedSuccessor = true;
      }
      if (next.revokedAt === null && next.expiresAt > new Date()) {
        liveLeafHash = next.tokenHash;
      }
      current = next;
    }

    if (!foundRotatedSuccessor || !liveLeafHash) {
      return null;
    }
    await this.revokeByHash(liveLeafHash, client);
    return liveLeafHash;
  }
}
