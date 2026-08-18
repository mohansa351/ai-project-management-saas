import { describe, expect, it, jest } from '@jest/globals';
import type { Organization, OrganizationMember, PrismaClient, User } from '@prisma/client';
import express from 'express';
import request from 'supertest';
import { createApp } from './app.js';
import { AuthController } from './controllers/authController.js';
import { HealthController } from './controllers/healthController.js';
import { dummyOrganizationController, OrganizationController } from './controllers/organizationController.js';
import type { EmailProvider } from './lib/email/emailProvider.js';
import { AUTH_SESSION_UNAUTHORIZED_MESSAGE } from './lib/http/authErrors.js';
import { success } from './lib/http/envelope.js';
import {
  AUTHZ_FORBIDDEN_MESSAGE,
  ORGANIZATION_NOT_FOUND_MESSAGE,
  ORG_CONTEXT_REQUIRED_MESSAGE,
} from './lib/http/orgErrors.js';
import { signAccessToken } from './lib/jwt.js';
import { errorHandler } from './middleware/errorHandler.js';
import { createRequireAccessToken } from './middleware/requireAccessToken.js';
import { createRequireOrganizationContext } from './middleware/requireOrganizationContext.js';
import { requestId } from './middleware/requestId.js';
import { OrganizationInviteRepository } from './repositories/organizationInviteRepository.js';
import { OrganizationMemberRepository } from './repositories/organizationMemberRepository.js';
import { OrganizationRepository } from './repositories/organizationRepository.js';
import { UserRepository } from './repositories/userRepository.js';
import type { HealthService } from './services/healthService.js';
import { OrganizationInviteService } from './services/organizationInviteService.js';
import { OrganizationMemberService } from './services/organizationMemberService.js';
import { OrganizationService } from './services/organizationService.js';

const now = new Date('2026-08-18T00:00:00.000Z');

type Store = {
  orgs: Organization[];
  members: OrganizationMember[];
  users: User[];
};

function storedUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user_1',
    email: 'ada@example.com',
    passwordHash: 'secret-hash',
    name: 'Ada',
    isActive: true,
    emailVerifiedAt: now,
    systemRole: 'USER',
    sessionEpoch: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function stubAuthController(): AuthController {
  return {
    register: jest.fn(),
    login: jest.fn(),
    logout: jest.fn(),
    refresh: jest.fn(),
    me: jest.fn(),
    changePassword: jest.fn(),
    verifyEmail: jest.fn(),
    resendVerification: jest.fn(),
    forgotPassword: jest.fn(),
    resetPassword: jest.fn(),
  } as unknown as AuthController;
}

function createFakePrisma(store: Store): PrismaClient {
  return {
    organization: {
      findFirst: jest.fn(async ({ where }: { where: { id: string; deletedAt?: null } }) => {
        const found = store.orgs.find(
          (org) => org.id === where.id && (where.deletedAt === undefined || org.deletedAt === where.deletedAt),
        );
        return found ? { ...found } : null;
      }),
      findMany: jest.fn(
        async ({
          where,
          skip,
          take,
          include,
        }: {
          where: { deletedAt: null; members: { some: { userId: string; status: 'ACTIVE' } } };
          skip: number;
          take: number;
          include?: {
            members?: { where: { userId: string; status: 'ACTIVE' }; take?: number };
          };
        }) => {
          const userId = where.members.some.userId;
          return store.orgs
            .filter(
              (org) =>
                org.deletedAt === null &&
                store.members.some(
                  (member) =>
                    member.organizationId === org.id &&
                    member.userId === userId &&
                    member.status === 'ACTIVE',
                ),
            )
            .slice(skip, skip + take)
            .map((org) => {
              const copy: (typeof org) & { members?: OrganizationMember[] } = { ...org };
              if (include?.members) {
                let members = store.members.filter(
                  (member) =>
                    member.organizationId === org.id &&
                    member.userId === include.members?.where.userId &&
                    member.status === include.members.where.status,
                );
                if (include.members.take !== undefined) {
                  members = members.slice(0, include.members.take);
                }
                copy.members = members.map((member) => ({ ...member }));
              }
              return copy;
            });
        },
      ),
      count: jest.fn(
        async ({
          where,
        }: {
          where: { deletedAt: null; members: { some: { userId: string; status: 'ACTIVE' } } };
        }) => {
          const userId = where.members.some.userId;
          return store.orgs.filter(
            (org) =>
              org.deletedAt === null &&
              store.members.some(
                (member) =>
                  member.organizationId === org.id &&
                  member.userId === userId &&
                  member.status === 'ACTIVE',
              ),
          ).length;
        },
      ),
    },
    user: {
      findUnique: jest.fn(async ({ where }: { where: { email?: string; id?: string } }) => {
        const found = store.users.find((user) =>
          where.id ? user.id === where.id : where.email ? user.email === where.email : false,
        );
        return found ? { ...found } : null;
      }),
    },
    organizationMember: {
      findFirst: jest.fn(
        async ({
          where,
        }: {
          where: { organizationId: string; userId: string; status?: OrganizationMember['status'] };
        }) => {
          const found = store.members.find(
            (member) =>
              member.organizationId === where.organizationId &&
              member.userId === where.userId &&
              (where.status === undefined || member.status === where.status),
          );
          return found ? { ...found } : null;
        },
      ),
    },
    organizationInvite: {},
  } as unknown as PrismaClient;
}

function seedOrg(store: Store, overrides: Partial<Organization> & Pick<Organization, 'id' | 'name'>): Organization {
  const org: Organization = {
    slug: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  };
  store.orgs.push(org);
  return org;
}

function contextApp(store: Store) {
  const prisma = createFakePrisma(store);
  const userRepository = new UserRepository(prisma);
  const organizationRepository = new OrganizationRepository(prisma);
  const organizationMemberRepository = new OrganizationMemberRepository(prisma);
  const requireAccessToken = createRequireAccessToken(userRepository);
  const requireOrganizationContext = createRequireOrganizationContext({
    organizationRepository,
    organizationMemberRepository,
  });
  return {
    prisma,
    requireAccessToken,
    requireOrganizationContext,
    app: createApp({
      healthController: new HealthController({
        getReadiness: jest.fn(async () => ({ status: 'ok', postgres: 'up', redis: 'up', uptime: 1 })),
      } as unknown as HealthService),
      authController: stubAuthController(),
      organizationController: new OrganizationController(
        new OrganizationService(organizationRepository, organizationMemberRepository, prisma),
        new OrganizationInviteService(
          organizationRepository,
          organizationMemberRepository,
          new OrganizationInviteRepository(prisma),
          userRepository,
          { send: jest.fn(async () => undefined) } as EmailProvider,
          prisma,
        ),
        new OrganizationMemberService(
          organizationRepository,
          organizationMemberRepository,
          new OrganizationInviteRepository(prisma),
          prisma,
        ),
      ),
      requireAccessToken,
      requireOrganizationContext,
    }),
  };
}

function harnessApp(store: Store) {
  const { requireAccessToken, requireOrganizationContext } = contextApp(store);
  const app = express();
  app.use(requestId);
  app.use(express.json());
  app.get(
    '/api/v1/__test/org-context',
    requireAccessToken,
    requireOrganizationContext,
    (req, res) => {
      res.status(200).json(success({ organizationId: req.organizationId }));
    },
  );
  app.use(errorHandler);
  return app;
}

async function bearer(user: User) {
  return signAccessToken({ sub: user.id, email: user.email, systemRole: user.systemRole });
}

describe('organization context header', () => {
  it('accepts X-Organization-Id for an ACTIVE membership on the reusable middleware', async () => {
    const store: Store = { orgs: [], members: [], users: [] };
    const user = storedUser();
    store.users.push(user);
    seedOrg(store, { id: 'org_a', name: 'Acme' });
    store.members.push({
      id: 'mem_1',
      organizationId: 'org_a',
      userId: user.id,
      role: 'TEAM_MEMBER',
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    });
    const app = harnessApp(store);

    const res = await request(app)
      .get('/api/v1/__test/org-context')
      .set('Authorization', `Bearer ${await bearer(user)}`)
      .set('X-Organization-Id', 'org_a')
      .expect(200);
    expect(res.body).toEqual({ success: true, data: { organizationId: 'org_a' } });
  });

  it('rejects missing header on the reusable middleware', async () => {
    const store: Store = { orgs: [], members: [], users: [] };
    const user = storedUser();
    store.users.push(user);
    seedOrg(store, { id: 'org_a', name: 'Acme' });
    store.members.push({
      id: 'mem_1',
      organizationId: 'org_a',
      userId: user.id,
      role: 'TEAM_MEMBER',
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    });
    const app = harnessApp(store);

    const res = await request(app)
      .get('/api/v1/__test/org-context')
      .set('Authorization', `Bearer ${await bearer(user)}`)
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toBe(ORG_CONTEXT_REQUIRED_MESSAGE);
  });

  it('forbids a spoofed header for an org without ACTIVE membership', async () => {
    const store: Store = { orgs: [], members: [], users: [] };
    const user = storedUser();
    store.users.push(user);
    seedOrg(store, { id: 'org_a', name: 'Acme' });
    seedOrg(store, { id: 'org_b', name: 'Beta' });
    store.members.push({
      id: 'mem_1',
      organizationId: 'org_a',
      userId: user.id,
      role: 'ORG_ADMIN',
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    });
    const { app } = contextApp(store);

    const spoof = await request(app)
      .get('/api/v1/organizations/org_a/members')
      .set('Authorization', `Bearer ${await bearer(user)}`)
      .set('X-Organization-Id', 'org_b')
      .expect(403);
    expect(spoof.body.error.code).toBe('AUTHZ_FORBIDDEN');
    expect(spoof.body.error.message).toBe(AUTHZ_FORBIDDEN_MESSAGE);
    expect(spoof.body.data).toBeUndefined();
  });

  it('returns 404 when the header org is missing or soft-deleted', async () => {
    const store: Store = { orgs: [], members: [], users: [] };
    const user = storedUser();
    store.users.push(user);
    seedOrg(store, { id: 'org_dead', name: 'Dead', deletedAt: now });
    const app = harnessApp(store);

    const gone = await request(app)
      .get('/api/v1/__test/org-context')
      .set('Authorization', `Bearer ${await bearer(user)}`)
      .set('X-Organization-Id', 'org_dead')
      .expect(404);
    expect(gone.body.error.code).toBe('NOT_FOUND');
    expect(gone.body.error.message).toBe(ORGANIZATION_NOT_FOUND_MESSAGE);
  });

  it('does not let a spoofed header reach another org by id', async () => {
    const store: Store = { orgs: [], members: [], users: [] };
    const user = storedUser();
    store.users.push(user);
    seedOrg(store, { id: 'org_a', name: 'Acme' });
    seedOrg(store, { id: 'org_b', name: 'Beta' });
    store.members.push({
      id: 'mem_1',
      organizationId: 'org_a',
      userId: user.id,
      role: 'ORG_ADMIN',
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    });
    const { app } = contextApp(store);

    const res = await request(app)
      .get('/api/v1/organizations/org_b')
      .set('Authorization', `Bearer ${await bearer(user)}`)
      .set('X-Organization-Id', 'org_a')
      .expect(403);
    expect(res.body.error.code).toBe('AUTHZ_FORBIDDEN');
    expect(res.body.error.message).toBe(AUTHZ_FORBIDDEN_MESSAGE);
    expect(res.body.data).toBeUndefined();
  });

  it('leaves by-id org GET working without a header', async () => {
    const store: Store = { orgs: [], members: [], users: [] };
    const user = storedUser();
    store.users.push(user);
    seedOrg(store, { id: 'org_a', name: 'Acme' });
    store.members.push({
      id: 'mem_1',
      organizationId: 'org_a',
      userId: user.id,
      role: 'TEAM_MEMBER',
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    });
    const { app } = contextApp(store);

    const res = await request(app)
      .get('/api/v1/organizations/org_a')
      .set('Authorization', `Bearer ${await bearer(user)}`)
      .expect(200);
    expect(res.body.data.organization.id).toBe('org_a');
  });

  it('returns 401 without a Bearer token before reading the org header', async () => {
    const store: Store = { orgs: [], members: [], users: [] };
    const app = harnessApp(store);
    const res = await request(app)
      .get('/api/v1/__test/org-context')
      .set('X-Organization-Id', 'org_a')
      .expect(401);
    expect(res.body.error.code).toBe('AUTH_UNAUTHORIZED');
    expect(res.body.error.message).toBe(AUTH_SESSION_UNAUTHORIZED_MESSAGE);
  });

  it('treats a blank X-Organization-Id as missing', async () => {
    const store: Store = { orgs: [], members: [], users: [] };
    const user = storedUser();
    store.users.push(user);
    seedOrg(store, { id: 'org_a', name: 'Acme' });
    store.members.push({
      id: 'mem_1',
      organizationId: 'org_a',
      userId: user.id,
      role: 'TEAM_MEMBER',
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    });
    const app = harnessApp(store);

    const res = await request(app)
      .get('/api/v1/__test/org-context')
      .set('Authorization', `Bearer ${await bearer(user)}`)
      .set('X-Organization-Id', '   ')
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toBe(ORG_CONTEXT_REQUIRED_MESSAGE);
    expect(res.body.error.details).toEqual({
      'x-organization-id': [ORG_CONTEXT_REQUIRED_MESSAGE],
    });
  });

  it('forbids SUPER_ADMIN from using a header for an org they are not an ACTIVE member of', async () => {
    const store: Store = { orgs: [], members: [], users: [] };
    const sa = storedUser({ id: 'user_sa', email: 'sa@example.com', name: 'SA', systemRole: 'SUPER_ADMIN' });
    store.users.push(sa);
    seedOrg(store, { id: 'org_a', name: 'Acme' });
    const app = harnessApp(store);

    const res = await request(app)
      .get('/api/v1/__test/org-context')
      .set('Authorization', `Bearer ${await bearer(sa)}`)
      .set('X-Organization-Id', 'org_a')
      .expect(403);
    expect(res.body.error.code).toBe('AUTHZ_FORBIDDEN');
    expect(res.body.data).toBeUndefined();
  });

  it('lists organizations without requiring X-Organization-Id when context middleware is wired', async () => {
    const store: Store = { orgs: [], members: [], users: [] };
    const user = storedUser();
    store.users.push(user);
    seedOrg(store, { id: 'org_a', name: 'Acme' });
    store.members.push({
      id: 'mem_1',
      organizationId: 'org_a',
      userId: user.id,
      role: 'ORG_ADMIN',
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    });
    const { app } = contextApp(store);

    const res = await request(app)
      .get('/api/v1/organizations')
      .set('Authorization', `Bearer ${await bearer(user)}`)
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.organizations).toEqual([expect.objectContaining({ id: 'org_a', name: 'Acme' })]);
  });

  it('does not apply org context middleware when the app has no org routes wired', async () => {
    const app = createApp({
      healthController: new HealthController({
        getReadiness: jest.fn(async () => ({ status: 'ok', postgres: 'up', redis: 'up', uptime: 1 })),
      } as unknown as HealthService),
      authController: stubAuthController(),
      organizationController: dummyOrganizationController(),
    });
    const res = await request(app).get('/api/v1/health').expect(200);
    expect(res.body.success).toBe(true);
  });
});
