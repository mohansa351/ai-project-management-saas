import type { PrismaClient, User } from '@prisma/client';
import { AppError } from '../lib/http/appError.js';

export type CreateUserInput = {
  email: string;
  passwordHash: string;
  name: string;
  systemRole: 'USER' | 'SUPER_ADMIN';
};

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
        throw new AppError('VALIDATION_ERROR', 'This email is already taken.', 400, {
          email: ['This email is already taken'],
        });
      }
      throw err;
    }
  }
}
