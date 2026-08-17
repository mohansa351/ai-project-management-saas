import type { PrismaClient, RefreshToken } from '@prisma/client';

export type CreateRefreshTokenInput = {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  userAgent?: string;
};

export class RefreshTokenRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreateRefreshTokenInput): Promise<RefreshToken> {
    return this.prisma.refreshToken.create({
      data: {
        userId: input.userId,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
        userAgent: input.userAgent,
      },
    });
  }

  /** Revokes a live (unrevoked, unexpired) row by hash. Returns rows updated (0 or 1). */
  async revokeByHash(tokenHash: string): Promise<number> {
    const result = await this.prisma.refreshToken.updateMany({
      where: {
        tokenHash,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { revokedAt: new Date() },
    });
    return result.count;
  }
}
