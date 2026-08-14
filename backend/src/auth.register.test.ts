import { describe, expect, it, jest } from '@jest/globals';
import type { User } from '@prisma/client';
import request from 'supertest';
import { createApp } from './app.js';
import { AuthController } from './controllers/authController.js';
import { HealthController } from './controllers/healthController.js';
import { verifyPassword } from './lib/password.js';
import type { UserRepository } from './repositories/userRepository.js';
import { AuthService } from './services/authService.js';
import type { HealthService, Readiness } from './services/healthService.js';

const okReadiness: Readiness = {
  status: 'ok',
  postgres: 'up',
  redis: 'up',
  uptime: 1,
};

function mockHealth(): HealthController {
  return new HealthController({
    getReadiness: jest.fn(async () => okReadiness),
  } as unknown as HealthService);
}

function storedUser(overrides: Partial<User> = {}): User {
  const now = new Date('2026-08-14T00:00:00.000Z');
  return {
    id: 'user_1',
    email: 'ada@example.com',
    passwordHash: 'hashed',
    name: 'Ada Lovelace',
    isActive: true,
    emailVerifiedAt: null,
    systemRole: 'USER',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function registerApp(userRepository: UserRepository, onUserRegistered = jest.fn(async () => undefined)) {
  const authController = new AuthController(new AuthService(userRepository, onUserRegistered));
  return createApp({
    healthController: mockHealth(),
    authController,
  });
}

describe('POST /api/v1/auth/register', () => {
  it('creates a user with bcrypt cost-12 hash and public 201 envelope', async () => {
    const create = jest.fn(
      async (input: { email: string; passwordHash: string; name: string; systemRole: 'USER' }) =>
        storedUser({
          email: input.email,
          passwordHash: input.passwordHash,
          name: input.name,
        }),
    );
    const findByEmail = jest.fn<UserRepository['findByEmail']>(async () => null);
    const onUserRegistered = jest.fn(async () => undefined);
    const app = registerApp({ create, findByEmail } as unknown as UserRepository, onUserRegistered);

    const plaintext = 'password1';
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ name: 'Ada Lovelace', email: 'Ada@Example.com', password: plaintext })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.user).toEqual({
      id: 'user_1',
      email: 'ada@example.com',
      name: 'Ada Lovelace',
      isActive: true,
      emailVerifiedAt: null,
      systemRole: 'USER',
      createdAt: '2026-08-14T00:00:00.000Z',
      updatedAt: '2026-08-14T00:00:00.000Z',
    });
    expect(res.body.data.user).not.toHaveProperty('password');
    expect(res.body.data.user).not.toHaveProperty('passwordHash');
    expect(JSON.stringify(res.body)).not.toContain(plaintext);

    expect(findByEmail).toHaveBeenCalledWith('ada@example.com');
    expect(create).toHaveBeenCalledTimes(1);
    const persisted = create.mock.calls[0]?.[0] as {
      passwordHash: string;
      email: string;
      systemRole: 'USER';
    };
    expect(persisted.email).toBe('ada@example.com');
    expect(persisted.systemRole).toBe('USER');
    expect(persisted.passwordHash).not.toBe(plaintext);
    expect(persisted.passwordHash).toMatch(/^\$2[aby]\$12\$/);
    await expect(verifyPassword(plaintext, persisted.passwordHash)).resolves.toBe(true);
    expect(onUserRegistered).toHaveBeenCalledTimes(1);
  });

  it('returns VALIDATION_ERROR for duplicate email without extra account fields', async () => {
    const existing = storedUser();
    const create = jest.fn();
    const findByEmail = jest.fn(async () => existing);
    const app = registerApp({ create, findByEmail } as unknown as UserRepository);

    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ name: 'Ada', email: 'ADA@example.com', password: 'password1' })
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message.toLowerCase()).toMatch(/taken|already/);
    expect(res.body.error.details).toEqual({ email: ['This email is already taken'] });
    expect(JSON.stringify(res.body)).not.toContain(existing.id);
    expect(JSON.stringify(res.body)).not.toContain(existing.name);
    expect(JSON.stringify(res.body)).not.toContain(existing.passwordHash);
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
    expect(create).not.toHaveBeenCalled();
  });

  it('returns field details for invalid body and does not write', async () => {
    const create = jest.fn();
    const findByEmail = jest.fn();
    const app = registerApp({ create, findByEmail } as unknown as UserRepository);

    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ name: '', email: 'not-an-email', password: 'short' })
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toEqual(
      expect.objectContaining({
        name: expect.any(Array),
        email: expect.any(Array),
        password: expect.any(Array),
      }),
    );
    expect(create).not.toHaveBeenCalled();
    expect(findByEmail).not.toHaveBeenCalled();
  });

  it('still includes invalid-body details when NODE_ENV=production', async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const create = jest.fn();
      const findByEmail = jest.fn();
      const app = registerApp({ create, findByEmail } as unknown as UserRepository);

      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({ name: '', email: 'bad', password: 'short' })
        .expect(400);

      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details).toEqual(
        expect.objectContaining({
          name: expect.any(Array),
          email: expect.any(Array),
          password: expect.any(Array),
        }),
      );
      expect(create).not.toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = previous;
    }
  });
});
