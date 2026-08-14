import type { User } from '@prisma/client';
import { AppError } from '../lib/http/appError.js';
import { hashPassword } from '../lib/password.js';
import { EMAIL_TAKEN_ERROR, type UserRepository } from '../repositories/userRepository.js';

export type PublicUser = {
  id: string;
  email: string;
  name: string;
  isActive: boolean;
  emailVerifiedAt: Date | null;
  systemRole: 'USER' | 'SUPER_ADMIN';
  createdAt: Date;
  updatedAt: Date;
};

export type OnUserRegistered = (user: PublicUser) => Promise<void>;

export type RegisterInput = {
  name: string;
  email: string;
  password: string;
};

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    isActive: user.isActive,
    emailVerifiedAt: user.emailVerifiedAt,
    systemRole: user.systemRole,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export class AuthService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly onUserRegistered: OnUserRegistered,
  ) {}

  async register(input: RegisterInput): Promise<PublicUser> {
    const email = input.email.toLowerCase();
    const existing = await this.userRepository.findByEmail(email);
    if (existing) {
      throw new AppError(
        'VALIDATION_ERROR',
        EMAIL_TAKEN_ERROR.message,
        400,
        EMAIL_TAKEN_ERROR.details,
      );
    }

    const passwordHash = await hashPassword(input.password);
    const user = await this.userRepository.create({
      email,
      passwordHash,
      name: input.name,
      systemRole: 'USER',
    });
    const publicUser = toPublicUser(user);
    await this.onUserRegistered(publicUser);
    return publicUser;
  }
}
