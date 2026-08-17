import type { PasswordResetToken, Prisma, PrismaClient } from '@prisma/client';

export type CreatePasswordResetTokenInput = {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
};

type PrismaClientOrTx = PrismaClient | Prisma.TransactionClient;

export class PasswordResetTokenRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(
    input: CreatePasswordResetTokenInput,
    client: PrismaClientOrTx = this.prisma,
  ): Promise<PasswordResetToken> {
    return client.passwordResetToken.create({
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
  ): Promise<PasswordResetToken | null> {
    const row = await client.passwordResetToken.findUnique({
      where: { tokenHash },
    });
    if (!row || row.usedAt !== null || row.expiresAt <= new Date()) {
      return null;
    }
    return row;
  }

  async markUsedIfActive(id: string, client: PrismaClientOrTx = this.prisma): Promise<number> {
    const result = await client.passwordResetToken.updateMany({
      where: { id, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
    return result.count;
  }

  async invalidateUnusedForUser(userId: string, client: PrismaClientOrTx = this.prisma): Promise<void> {
    await client.passwordResetToken.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: new Date() },
    });
  }

  async lockForUser(userId: string, client: PrismaClientOrTx = this.prisma): Promise<void> {
    // Same hashtext(userId) key as EmailVerificationTokenRepository.lockForIssuance so
    // forgot, reset, and resend-verification serialize per user.
    await client.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
  }
}
