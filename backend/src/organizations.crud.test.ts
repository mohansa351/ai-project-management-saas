import { describe, expect, it, jest } from '@jest/globals';
import type { Organization, OrganizationMember, PrismaClient, User } from '@prisma/client';
import request from 'supertest';
import { createApp } from './app.js';
import { AuthController } from './controllers/authController.js';
import { HealthController } from './controllers/healthController.js';
import { OrganizationController } from './controllers/organizationController.js';
import { AUTH_SESSION_UNAUTHORIZED_MESSAGE } from './lib/http/authErrors.js';
import { AUTHZ_FORBIDDEN_MESSAGE, ORGANIZATION_NOT_FOUND_MESSAGE } from './lib/http/orgErrors.js';
import { signAccessToken } from './lib/jwt.js';
import { createRequireAccessToken } from './middleware/requireAccessToken.js';
import { OrganizationMemberRepository } from './repositories/organizationMemberRepository.js';
import { OrganizationRepository } from './repositories/organizationRepository.js';
import type { UserRepository } from './repositories/userRepository.js';
import type { HealthService } from './services/healthService.js';
import { OrganizationService } from './services/organizationService.js';

const now = new Date('2026-08-18T00:00:00.000Z');

type StoredOrg = Organization;
type StoredMember = OrganizationMember;

type OrgStore = {
  orgs: StoredOrg[];
  members: StoredMember[];
  ids: number;
};

function storedUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user_1',
    email: 'ada@example.com',
    passwordHash: 'secret-hash',
    name: 'Ada Lovelace',
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

function p2002(): Error {
  return Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
}

function liveSlugTaken(store: OrgStore, slug: string | null | undefined, excludeId?: string): boolean {
  if (!slug) {
    return false;
  }
  return store.orgs.some((org) => org.slug === slug && org.deletedAt === null && org.id !== excludeId);
}

function createFakePrisma(store: OrgStore): PrismaClient {
  const client = {
    organization: {
      create: jest.fn(async ({ data }: { data: { name: string; slug?: string | null } }) => {
        if (liveSlugTaken(store, data.slug)) {
          throw p2002();
        }
        const org: StoredOrg = {
          id: `org_${++store.ids}`,
          name: data.name,
          slug: data.slug ?? null,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        };
        store.orgs.push(org);
        return { ...org };
      }),
      findFirst: jest.fn(async ({ where }: { where: { id: string; deletedAt?: null } }) => {
        const found = store.orgs.find(
          (org) => org.id === where.id && (where.deletedAt === undefined || org.deletedAt === where.deletedAt),
        );
        return found ? { ...found } : null;
      }),
      findMany: jest.fn(
        async ({
          where,
          orderBy,
          skip,
          take,
        }: {
          where: {
            deletedAt: null;
            members: { some: { userId: string; status: 'ACTIVE' } };
          };
          orderBy: Array<{ createdAt?: 'desc'; id?: 'desc' }>;
          skip: number;
          take: number;
        }) => {
          const matched = store.orgs
            .filter((org) => org.deletedAt === where.deletedAt)
            .filter((org) =>
              store.members.some(
                (member) =>
                  member.organizationId === org.id &&
                  member.userId === where.members.some.userId &&
                  member.status === where.members.some.status,
              ),
            )
            .sort((a, b) => {
              for (const key of orderBy) {
                if (key.createdAt === 'desc' && a.createdAt.getTime() !== b.createdAt.getTime()) {
                  return b.createdAt.getTime() - a.createdAt.getTime();
                }
                if (key.id === 'desc' && a.id !== b.id) {
                  return a.id < b.id ? 1 : -1;
                }
              }
              return 0;
            });
          return matched.slice(skip, skip + take).map((org) => ({ ...org }));
        },
      ),
      count: jest.fn(
        async ({
          where,
        }: {
          where: {
            deletedAt: null;
            members: { some: { userId: string; status: 'ACTIVE' } };
          };
        }) =>
          store.orgs.filter(
            (org) =>
              org.deletedAt === where.deletedAt &&
              store.members.some(
                (member) =>
                  member.organizationId === org.id &&
                  member.userId === where.members.some.userId &&
                  member.status === where.members.some.status,
              ),
          ).length,
      ),
      updateMany: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string; deletedAt: null };
          data: { name?: string; slug?: string | null; deletedAt?: Date };
        }) => {
          const index = store.orgs.findIndex(
            (org) => org.id === where.id && org.deletedAt === where.deletedAt,
          );
          const current = store.orgs[index];
          if (index === -1 || !current) {
            return { count: 0 };
          }
          if (data.slug !== undefined && liveSlugTaken(store, data.slug, current.id)) {
            throw p2002();
          }
          const next: StoredOrg = {
            ...current,
            ...data,
            updatedAt: now,
          };
          store.orgs[index] = next;
          return { count: 1 };
        },
      ),
    },
    organizationMember: {
      upsert: jest.fn(
        async ({
          where,
          create,
        }: {
          where: { organizationId_userId: { organizationId: string; userId: string } };
          create: {
            organizationId: string;
            userId: string;
            role: StoredMember['role'];
            status: StoredMember['status'];
          };
          update: { role: StoredMember['role']; status: StoredMember['status'] };
        }) => {
          const existing = store.members.find(
            (member) =>
              member.organizationId === where.organizationId_userId.organizationId &&
              member.userId === where.organizationId_userId.userId,
          );
          if (existing) {
            existing.role = create.role;
            existing.status = create.status;
            existing.updatedAt = now;
            return { ...existing };
          }
          const member: StoredMember = {
            id: `mem_${++store.ids}`,
            organizationId: create.organizationId,
            userId: create.userId,
            role: create.role,
            status: create.status,
            createdAt: now,
            updatedAt: now,
          };
          store.members.push(member);
          return { ...member };
        },
      ),
      findFirst: jest.fn(
        async ({
          where,
        }: {
          where: { organizationId: string; userId: string; status: 'ACTIVE' };
        }) => {
          const found = store.members.find(
            (member) =>
              member.organizationId === where.organizationId &&
              member.userId === where.userId &&
              member.status === where.status,
          );
          return found ? { ...found } : null;
        },
      ),
    },
    $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => {
      const orgSnap = store.orgs.map((org) => ({ ...org }));
      const memberSnap = store.members.map((member) => ({ ...member }));
      try {
        return await fn(client);
      } catch (err) {
        store.orgs.splice(0, store.orgs.length, ...orgSnap);
        store.members.splice(0, store.members.length, ...memberSnap);
        throw err;
      }
    }),
  };
  return client as unknown as PrismaClient;
}

function seedOrg(
  store: OrgStore,
  overrides: Partial<StoredOrg> & Pick<StoredOrg, 'id' | 'name'>,
): StoredOrg {
  const org: StoredOrg = {
    slug: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  };
  store.orgs.push(org);
  return org;
}

function seedMember(
  store: OrgStore,
  overrides: Pick<StoredMember, 'organizationId' | 'userId' | 'role' | 'status'> & Partial<StoredMember>,
): StoredMember {
  const member: StoredMember = {
    id: `mem_${++store.ids}`,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
  store.members.push(member);
  return member;
}

function orgApp(user: User | null, store: OrgStore) {
  const prisma = createFakePrisma(store);
  const userRepository = {
    findById: jest.fn(async () => user),
  } as unknown as UserRepository;
  return {
    store,
    prisma,
    app: createApp({
      healthController: new HealthController({
        getReadiness: jest.fn(async () => ({ status: 'ok', postgres: 'up', redis: 'up', uptime: 1 })),
      } as unknown as HealthService),
      authController: stubAuthController(),
      organizationController: new OrganizationController(
        new OrganizationService(
          new OrganizationRepository(prisma),
          new OrganizationMemberRepository(prisma),
          prisma,
        ),
      ),
      requireAccessToken: createRequireAccessToken(userRepository),
    }),
  };
}

async function bearer(userId: string, email = 'ada@example.com', systemRole: User['systemRole'] = 'USER') {
  return signAccessToken({ sub: userId, email, systemRole });
}

describe('organization CRUD', () => {
  it('creates an org and upserts the caller as ACTIVE ORG_ADMIN', async () => {
    const store: OrgStore = { orgs: [], members: [], ids: 0 };
    const { app } = orgApp(storedUser(), store);
    const token = await bearer('user_1');

    const res = await request(app)
      .post('/api/v1/organizations')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: '  Acme  ', slug: 'Acme-Labs' })
      .expect(201);

    expect(res.body).toEqual({
      success: true,
      data: {
        organization: {
          id: 'org_1',
          name: 'Acme',
          slug: 'acme-labs',
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
          deletedAt: null,
        },
      },
    });
    expect(store.members).toEqual([
      expect.objectContaining({
        organizationId: 'org_1',
        userId: 'user_1',
        role: 'ORG_ADMIN',
        status: 'ACTIVE',
      }),
    ]);
  });

  it('rolls back org insert when the admin member write fails', async () => {
    const store: OrgStore = { orgs: [], members: [], ids: 0 };
    const { app, prisma } = orgApp(storedUser(), store);
    prisma.organizationMember.upsert = jest.fn(async () => {
      throw new Error('member insert failed');
    }) as unknown as typeof prisma.organizationMember.upsert;
    const token = await bearer('user_1');

    await request(app)
      .post('/api/v1/organizations')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Rollback Co' })
      .expect(500);

    expect(store.orgs).toHaveLength(0);
    expect(store.members).toHaveLength(0);
  });

  it('lists only live orgs with ACTIVE membership and paginates', async () => {
    const store: OrgStore = { orgs: [], members: [], ids: 0 };
    seedOrg(store, { id: 'org_a', name: 'A', createdAt: new Date('2026-08-18T00:03:00.000Z') });
    seedOrg(store, { id: 'org_b', name: 'B', createdAt: new Date('2026-08-18T00:02:00.000Z') });
    seedOrg(store, { id: 'org_c', name: 'C', createdAt: new Date('2026-08-18T00:01:00.000Z') });
    seedOrg(store, {
      id: 'org_d',
      name: 'D',
      deletedAt: now,
      createdAt: new Date('2026-08-18T00:00:00.000Z'),
    });
    seedMember(store, { organizationId: 'org_a', userId: 'user_1', role: 'ORG_ADMIN', status: 'ACTIVE' });
    seedMember(store, { organizationId: 'org_b', userId: 'user_1', role: 'TEAM_MEMBER', status: 'ACTIVE' });
    seedMember(store, { organizationId: 'org_c', userId: 'user_1', role: 'ORG_ADMIN', status: 'PENDING' });
    seedMember(store, { organizationId: 'org_d', userId: 'user_1', role: 'ORG_ADMIN', status: 'ACTIVE' });
    const { app } = orgApp(storedUser(), store);
    const token = await bearer('user_1');

    const res = await request(app)
      .get('/api/v1/organizations')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.data.organizations.map((org: { id: string }) => org.id)).toEqual(['org_a', 'org_b']);
    expect(res.body.meta).toEqual({ page: 1, pageSize: 20, total: 2, totalPages: 1 });

    const page = await request(app)
      .get('/api/v1/organizations')
      .query({ page: 2, pageSize: 1 })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(page.body.data.organizations.map((org: { id: string }) => org.id)).toEqual(['org_b']);
    expect(page.body.meta).toEqual({ page: 2, pageSize: 1, total: 2, totalPages: 2 });
  });

  it('returns 200 for GET by id when the caller is an ACTIVE TEAM_MEMBER', async () => {
    const store: OrgStore = { orgs: [], members: [], ids: 0 };
    seedOrg(store, { id: 'org_a', name: 'A', slug: 'a' });
    seedMember(store, { organizationId: 'org_a', userId: 'user_2', role: 'TEAM_MEMBER', status: 'ACTIVE' });
    const { app } = orgApp(storedUser({ id: 'user_2', email: 'team@example.com' }), store);
    const token = await bearer('user_2', 'team@example.com');

    const res = await request(app)
      .get('/api/v1/organizations/org_a')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.data.organization.id).toBe('org_a');
    expect(res.body.data.organization.name).toBe('A');
  });

  it('lets an ACTIVE PROJECT_MANAGER GET a live org they belong to', async () => {
    const store: OrgStore = { orgs: [], members: [], ids: 0 };
    seedOrg(store, { id: 'org_a', name: 'A', slug: 'a' });
    seedMember(store, { organizationId: 'org_a', userId: 'user_pm', role: 'PROJECT_MANAGER', status: 'ACTIVE' });
    const { app } = orgApp(storedUser({ id: 'user_pm', email: 'pm@example.com' }), store);
    const token = await bearer('user_pm', 'pm@example.com');

    const res = await request(app)
      .get('/api/v1/organizations/org_a')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.data.organization.id).toBe('org_a');
  });

  it('returns 403 when an ACTIVE member of one org requests another org by id', async () => {
    const store: OrgStore = { orgs: [], members: [], ids: 0 };
    seedOrg(store, { id: 'org_a', name: 'A' });
    seedOrg(store, { id: 'org_b', name: 'B' });
    seedMember(store, { organizationId: 'org_a', userId: 'user_1', role: 'ORG_ADMIN', status: 'ACTIVE' });
    const { app } = orgApp(storedUser(), store);
    const token = await bearer('user_1');

    const res = await request(app)
      .get('/api/v1/organizations/org_b')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
    expect(res.body.error.code).toBe('AUTHZ_FORBIDDEN');
    expect(JSON.stringify(res.body)).not.toContain('"B"');
  });

  it('returns 403 AUTHZ_FORBIDDEN without an org payload for strangers and PENDING members', async () => {
    const store: OrgStore = { orgs: [], members: [], ids: 0 };
    seedOrg(store, { id: 'org_a', name: 'Secret Org', slug: 'secret-org' });
    seedMember(store, { organizationId: 'org_a', userId: 'user_pending', role: 'TEAM_MEMBER', status: 'PENDING' });
    const stranger = orgApp(storedUser({ id: 'user_2', email: 'other@example.com' }), store);
    const pending = orgApp(
      storedUser({ id: 'user_pending', email: 'pending@example.com' }),
      store,
    );
    const strangerToken = await bearer('user_2', 'other@example.com');
    const pendingToken = await bearer('user_pending', 'pending@example.com');

    for (const [app, token] of [
      [stranger.app, strangerToken],
      [pending.app, pendingToken],
    ] as const) {
      const res = await request(app)
        .get('/api/v1/organizations/org_a')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
      expect(res.body).toEqual({
        success: false,
        error: { code: 'AUTHZ_FORBIDDEN', message: AUTHZ_FORBIDDEN_MESSAGE },
      });
      expect(res.body).not.toHaveProperty('data');
      expect(JSON.stringify(res.body)).not.toContain('Secret Org');
    }
  });

  it('returns 404 NOT_FOUND for unknown and soft-deleted ids', async () => {
    const store: OrgStore = { orgs: [], members: [], ids: 0 };
    seedOrg(store, { id: 'org_gone', name: 'Gone', deletedAt: now });
    seedMember(store, { organizationId: 'org_gone', userId: 'user_1', role: 'ORG_ADMIN', status: 'ACTIVE' });
    const { app } = orgApp(storedUser(), store);
    const token = await bearer('user_1');

    for (const id of ['missing', 'org_gone']) {
      const res = await request(app)
        .get(`/api/v1/organizations/${id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
      expect(res.body.error.message).toBe(ORGANIZATION_NOT_FOUND_MESSAGE);
    }
  });

  it('lets an ACTIVE ORG_ADMIN patch and soft-delete a live org', async () => {
    const store: OrgStore = { orgs: [], members: [], ids: 0 };
    seedOrg(store, { id: 'org_a', name: 'Acme', slug: 'acme' });
    seedMember(store, { organizationId: 'org_a', userId: 'user_1', role: 'ORG_ADMIN', status: 'ACTIVE' });
    const { app } = orgApp(storedUser(), store);
    const token = await bearer('user_1');

    const patched = await request(app)
      .patch('/api/v1/organizations/org_a')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Acme Renamed' })
      .expect(200);
    expect(patched.body.data.organization.name).toBe('Acme Renamed');
    expect(store.orgs[0]?.name).toBe('Acme Renamed');
    expect(store.members).toHaveLength(1);

    const deleted = await request(app)
      .delete('/api/v1/organizations/org_a')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(typeof deleted.body.data.organization.deletedAt).toBe('string');
    expect(deleted.body.data.organization.deletedAt).not.toBeNull();
    expect(store.orgs[0]?.deletedAt).toBeInstanceOf(Date);
    expect(store.members).toHaveLength(1);

    await request(app).get('/api/v1/organizations/org_a').set('Authorization', `Bearer ${token}`).expect(404);
  });

  it('rejects PATCH and DELETE from an ACTIVE TEAM_MEMBER with 403 and no write', async () => {
    const store: OrgStore = { orgs: [], members: [], ids: 0 };
    seedOrg(store, { id: 'org_a', name: 'Acme', slug: 'acme' });
    seedMember(store, { organizationId: 'org_a', userId: 'user_2', role: 'TEAM_MEMBER', status: 'ACTIVE' });
    const { app } = orgApp(storedUser({ id: 'user_2', email: 'team@example.com' }), store);
    const token = await bearer('user_2', 'team@example.com');

    const patched = await request(app)
      .patch('/api/v1/organizations/org_a')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Hacked' })
      .expect(403);
    expect(patched.body.error.code).toBe('AUTHZ_FORBIDDEN');
    expect(store.orgs[0]?.name).toBe('Acme');

    const deleted = await request(app)
      .delete('/api/v1/organizations/org_a')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
    expect(deleted.body.error.code).toBe('AUTHZ_FORBIDDEN');
    expect(store.orgs[0]?.deletedAt).toBeNull();
  });

  it('rejects PATCH and DELETE from an ACTIVE PROJECT_MANAGER with 403 and no write', async () => {
    const store: OrgStore = { orgs: [], members: [], ids: 0 };
    seedOrg(store, { id: 'org_a', name: 'Acme', slug: 'acme' });
    seedMember(store, { organizationId: 'org_a', userId: 'user_pm', role: 'PROJECT_MANAGER', status: 'ACTIVE' });
    const { app } = orgApp(storedUser({ id: 'user_pm', email: 'pm@example.com' }), store);
    const token = await bearer('user_pm', 'pm@example.com');

    await request(app)
      .patch('/api/v1/organizations/org_a')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Hacked' })
      .expect(403);
    expect(store.orgs[0]?.name).toBe('Acme');

    await request(app)
      .delete('/api/v1/organizations/org_a')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
    expect(store.orgs[0]?.deletedAt).toBeNull();
  });

  it('does not let SUPER_ADMIN PATCH or DELETE without membership', async () => {
    const store: OrgStore = { orgs: [], members: [], ids: 0 };
    seedOrg(store, { id: 'org_a', name: 'Acme', slug: 'acme' });
    const { app } = orgApp(
      storedUser({ id: 'user_sa', email: 'sa@example.com', systemRole: 'SUPER_ADMIN' }),
      store,
    );
    const token = await bearer('user_sa', 'sa@example.com', 'SUPER_ADMIN');

    await request(app)
      .patch('/api/v1/organizations/org_a')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Hacked' })
      .expect(403);
    expect(store.orgs[0]?.name).toBe('Acme');

    await request(app)
      .delete('/api/v1/organizations/org_a')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
    expect(store.orgs[0]?.deletedAt).toBeNull();
  });

  it('returns 401 AUTH_UNAUTHORIZED without a valid Bearer token', async () => {
    const store: OrgStore = { orgs: [], members: [], ids: 0 };
    const { app } = orgApp(storedUser(), store);

    const cases = [
      request(app).post('/api/v1/organizations').send({ name: 'Acme' }),
      request(app).get('/api/v1/organizations'),
      request(app).get('/api/v1/organizations/org_a').set('Authorization', 'Bearer'),
    ];
    for (const pending of cases) {
      const res = await pending.expect(401);
      expect(res.body.error.code).toBe('AUTH_UNAUTHORIZED');
      expect(res.body.error.message).toBe(AUTH_SESSION_UNAUTHORIZED_MESSAGE);
    }
    expect(store.orgs).toHaveLength(0);
  });

  it('does not let SUPER_ADMIN bypass org membership on these routes', async () => {
    const store: OrgStore = { orgs: [], members: [], ids: 0 };
    seedOrg(store, { id: 'org_a', name: 'Acme' });
    const { app } = orgApp(
      storedUser({ id: 'user_sa', email: 'sa@example.com', systemRole: 'SUPER_ADMIN' }),
      store,
    );
    const token = await bearer('user_sa', 'sa@example.com', 'SUPER_ADMIN');
    const res = await request(app)
      .get('/api/v1/organizations/org_a')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
    expect(res.body.error.code).toBe('AUTHZ_FORBIDDEN');
  });

  it('returns 400 VALIDATION_ERROR with field details and no DB write for invalid bodies', async () => {
    const store: OrgStore = { orgs: [], members: [], ids: 0 };
    seedOrg(store, { id: 'org_a', name: 'Acme', slug: 'acme' });
    seedMember(store, { organizationId: 'org_a', userId: 'user_1', role: 'ORG_ADMIN', status: 'ACTIVE' });
    const { app } = orgApp(storedUser(), store);
    const token = await bearer('user_1');

    const emptyName = await request(app)
      .post('/api/v1/organizations')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: '   ' })
      .expect(400);
    expect(emptyName.body.error.code).toBe('VALIDATION_ERROR');
    expect(emptyName.body.error.details).toEqual(expect.objectContaining({ name: expect.any(Array) }));
    expect(store.orgs).toHaveLength(1);

    const badSlug = await request(app)
      .post('/api/v1/organizations')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Beta', slug: 'Bad Slug' })
      .expect(400);
    expect(badSlug.body.error.code).toBe('VALIDATION_ERROR');
    expect(badSlug.body.error.details).toEqual(expect.objectContaining({ slug: expect.any(Array) }));
    expect(store.orgs).toHaveLength(1);

    const emptyPatch = await request(app)
      .patch('/api/v1/organizations/org_a')
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(400);
    expect(emptyPatch.body.error.code).toBe('VALIDATION_ERROR');
    expect(emptyPatch.body.error.details).toEqual(
      expect.objectContaining({
        name: expect.any(Array),
        slug: expect.any(Array),
      }),
    );
    expect(store.orgs[0]?.name).toBe('Acme');
  });

  it('rejects a duplicate live slug with 400 VALIDATION_ERROR and does not insert a second live slug', async () => {
    const store: OrgStore = { orgs: [], members: [], ids: 0 };
    seedOrg(store, { id: 'org_a', name: 'Acme', slug: 'acme' });
    seedOrg(store, { id: 'org_dead', name: 'Dead', slug: 'reused', deletedAt: now });
    const { app } = orgApp(storedUser(), store);
    const token = await bearer('user_1');

    const duplicate = await request(app)
      .post('/api/v1/organizations')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Other', slug: 'acme' })
      .expect(400);
    expect(duplicate.body.error.code).toBe('VALIDATION_ERROR');
    expect(duplicate.body.error.details).toEqual({ slug: ['This slug is already taken'] });
    expect(store.orgs.filter((org) => org.slug === 'acme' && org.deletedAt === null)).toHaveLength(1);

    const reuseDeleted = await request(app)
      .post('/api/v1/organizations')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Reborn', slug: 'reused' })
      .expect(201);
    expect(reuseDeleted.body.data.organization.slug).toBe('reused');
  });

  it('normalizes PATCH slug and rejects a duplicate live slug on PATCH', async () => {
    const store: OrgStore = { orgs: [], members: [], ids: 0 };
    seedOrg(store, { id: 'org_a', name: 'Acme', slug: 'acme' });
    seedOrg(store, { id: 'org_b', name: 'Beta', slug: 'beta' });
    seedOrg(store, { id: 'org_dead', name: 'Dead', slug: 'from-dead', deletedAt: now });
    seedMember(store, { organizationId: 'org_a', userId: 'user_1', role: 'ORG_ADMIN', status: 'ACTIVE' });
    const { app } = orgApp(storedUser(), store);
    const token = await bearer('user_1');

    const renamed = await request(app)
      .patch('/api/v1/organizations/org_a')
      .set('Authorization', `Bearer ${token}`)
      .send({ slug: 'Acme-Labs' })
      .expect(200);
    expect(renamed.body.data.organization.slug).toBe('acme-labs');

    const taken = await request(app)
      .patch('/api/v1/organizations/org_a')
      .set('Authorization', `Bearer ${token}`)
      .send({ slug: 'beta' })
      .expect(400);
    expect(taken.body.error.code).toBe('VALIDATION_ERROR');
    expect(taken.body.error.details).toEqual({ slug: ['This slug is already taken'] });
    expect(store.orgs.find((org) => org.id === 'org_a')?.slug).toBe('acme-labs');

    const reused = await request(app)
      .patch('/api/v1/organizations/org_a')
      .set('Authorization', `Bearer ${token}`)
      .send({ slug: 'from-dead' })
      .expect(200);
    expect(reused.body.data.organization.slug).toBe('from-dead');
  });
});
