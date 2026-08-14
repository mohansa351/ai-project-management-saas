import type { EmailVerificationToken, Prisma, PrismaClient } from '@prisma/client';

export type CreateEmailVerificationTokenInput = {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
};

type PrismaClientOrTx = PrismaClient | Prisma.TransactionClient;

export class EmailVerificationTokenRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(
    input: CreateEmailVerificationTokenInput,
    client: PrismaClientOrTx = this.prisma,
  ): Promise<EmailVerificationToken> {
    return client.emailVerificationToken.create({
      data: {
        userId: input.userId,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
      },
    });
  }

  async findValidByHash(
    tokenHash: string,
    client: PrismaClientOrTx = this.prisma,
  ): Promise<EmailVerificationToken | null> {
    return client.emailVerificationToken.findFirst({
      where: {
        tokenHash,
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
  }

  /** Atomically consumes a token only if it hasn't already been consumed. Returns the number of rows affected (0 or 1); callers must check this to guard against a concurrent double-consume. */
  async markConsumedIfActive(id: string, client: PrismaClientOrTx = this.prisma): Promise<number> {
    const result = await client.emailVerificationToken.updateMany({
      where: { id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    return result.count;
  }

  /** Invalidate (consume) every unconsumed token for a user, e.g. before issuing a new one. */
  async invalidateActiveForUser(userId: string, client: PrismaClientOrTx = this.prisma): Promise<void> {
    await client.emailVerificationToken.updateMany({
      where: { userId, consumedAt: null },
      data: { consumedAt: new Date() },
    });
  }

  /**
   * Acquires a transaction-scoped Postgres advisory lock keyed by userId (auto-released at
   * commit/rollback). Must be called *inside* the same `$transaction` as `invalidateActiveForUser`
   * + `create`: under the default READ COMMITTED isolation, wrapping those two statements in a
   * transaction alone is NOT enough to prevent two concurrent issuances for the same user — both
   * transactions can see "no active token" before either commits. This lock serializes concurrent
   * issuance attempts for the same user so that invariant actually holds.
   */
  async lockForIssuance(userId: string, client: PrismaClientOrTx = this.prisma): Promise<void> {
    await client.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
  }
}
