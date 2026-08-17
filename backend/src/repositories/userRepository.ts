import type { Prisma, PrismaClient, User } from '@prisma/client';
import { AppError } from '../lib/http/appError.js';

export type CreateUserInput = {
  email: string;
  passwordHash: string;
  name: string;
  systemRole: 'USER' | 'SUPER_ADMIN';
};

type PrismaClientOrTx = PrismaClient | Prisma.TransactionClient;

export const EMAIL_TAKEN_ERROR = {
  message: 'This email is already taken.',
  details: { email: ['This email is already taken'] },
} as const;

function isUniqueConstraint(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === 'P2002'
  );
}

export class UserRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  }

  async findById(id: string, client: PrismaClientOrTx = this.prisma): Promise<User | null> {
    return client.user.findUnique({ where: { id } });
  }

  async markEmailVerified(id: string, client: PrismaClientOrTx = this.prisma): Promise<User> {
    return client.user.update({
      where: { id },
      data: { emailVerifiedAt: new Date() },
    });
  }

  async updatePasswordAndBumpEpoch(
    id: string,
    passwordHash: string,
    client: PrismaClientOrTx = this.prisma,
  ): Promise<User> {
    return client.user.update({
      where: { id },
      data: {
        passwordHash,
        sessionEpoch: { increment: 1 },
      },
    });
  }

  async casSessionEpoch(
    id: string,
    expected: number,
    client: PrismaClientOrTx = this.prisma,
  ): Promise<number> {
    // No-op assignment still row-locks User so a concurrent sessionEpoch increment
    // cannot commit between refresh claim and successor insert.
    const result = await client.user.updateMany({
      where: { id, sessionEpoch: expected },
      data: { sessionEpoch: expected },
    });
    return result.count;
  }

  async create(input: CreateUserInput): Promise<User> {
    try {
      return await this.prisma.user.create({
        data: {
          email: input.email.toLowerCase(),
          passwordHash: input.passwordHash,
          name: input.name,
          systemRole: input.systemRole,
          emailVerifiedAt: null,
        },
      });
    } catch (err) {
      if (isUniqueConstraint(err)) {
        throw new AppError(
          'VALIDATION_ERROR',
          EMAIL_TAKEN_ERROR.message,
          400,
          EMAIL_TAKEN_ERROR.details,
        );
      }
      throw err;
    }
  }
}
