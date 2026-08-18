import { describe, expect, it, jest } from '@jest/globals';
import type {
  Organization,
  OrganizationInvite,
  OrganizationMember,
  PrismaClient,
  User,
} from '@prisma/client';
import request from 'supertest';
import { createApp } from './app.js';
import { AuthController } from './controllers/authController.js';
import { HealthController } from './controllers/healthController.js';
import { OrganizationController } from './controllers/organizationController.js';
import type { EmailProvider } from './lib/email/emailProvider.js';
import { AUTH_SESSION_UNAUTHORIZED_MESSAGE } from './lib/http/authErrors.js';
import {
  AUTHZ_FORBIDDEN_MESSAGE,
  LAST_ACTIVE_ORG_ADMIN_ERROR,
  ORGANIZATION_NOT_FOUND_MESSAGE,
  ORG_INVITE_TOKEN_INVALID_MESSAGE,
} from './lib/http/orgErrors.js';
import { signAccessToken } from './lib/jwt.js';
import { hashToken } from './lib/token.js';
import { createRequireAccessToken } from './middleware/requireAccessToken.js';
import { OrganizationInviteRepository } from './repositories/organizationInviteRepository.js';
import { OrganizationMemberRepository } from './repositories/organizationMemberRepository.js';
import { OrganizationRepository } from './repositories/organizationRepository.js';
import { UserRepository } from './repositories/userRepository.js';
import type { HealthService } from './services/healthService.js';
import { OrganizationInviteService } from './services/organizationInviteService.js';
import { OrganizationMemberService } from './services/organizationMemberService.js';
import { OrganizationService } from './services/organizationService.js';

const now = new Date('2026-08-18T00:00:00.000Z');

type MemberStore = {
  orgs: Organization[];
  members: OrganizationMember[];
  invites: OrganizationInvite[];
  users: User[];
  ids: number;
};

function storedUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user_admin',
    email: 'admin@example.com',
    passwordHash: 'secret-hash',
    name: 'Org Admin',
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

function publicUser(user: User) {
  return { id: user.id, email: user.email, name: user.name };
}

function withUser(store: MemberStore, member: OrganizationMember) {
  const user = store.users.find((row) => row.id === member.userId);
  if (!user) {
    throw new Error(`missing user ${member.userId}`);
  }
  return { ...member, user: publicUser(user) };
}

function createFakePrisma(store: MemberStore): PrismaClient {
  const client = {
    organization: {
      findFirst: jest.fn(async ({ where }: { where: { id: string; deletedAt?: null } }) => {
        const found = store.orgs.find(
          (org) => org.id === where.id && (where.deletedAt === undefined || org.deletedAt === where.deletedAt),
        );
        return found ? { ...found } : null;
      }),
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
      upsert: jest.fn(
        async ({
          where,
          create,
          update,
        }: {
          where: { organizationId_userId: { organizationId: string; userId: string } };
          create: {
            organizationId: string;
            userId: string;
            role: OrganizationMember['role'];
            status: OrganizationMember['status'];
          };
          update: { role: OrganizationMember['role']; status: OrganizationMember['status'] };
        }) => {
          const existing = store.members.find(
            (member) =>
              member.organizationId === where.organizationId_userId.organizationId &&
              member.userId === where.organizationId_userId.userId,
          );
          if (existing) {
            existing.role = update.role;
            existing.status = update.status;
            existing.updatedAt = now;
            return { ...existing };
          }
          const member: OrganizationMember = {
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
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => {
        const found = store.members.find((member) => member.id === where.id);
        return found ? withUser(store, found) : null;
      }),
      findMany: jest.fn(
        async ({
          where,
          orderBy,
          skip,
          take,
        }: {
          where: { organizationId: string };
          orderBy: Array<{ createdAt?: 'desc'; id?: 'desc' }>;
          skip: number;
          take: number;
        }) => {
          const matched = store.members
            .filter((member) => member.organizationId === where.organizationId)
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
          return matched.slice(skip, skip + take).map((member) => withUser(store, member));
        },
      ),
      count: jest.fn(
        async ({
          where,
        }: {
          where: {
            organizationId: string;
            role?: OrganizationMember['role'];
            status?: OrganizationMember['status'];
          };
        }) =>
          store.members.filter(
            (member) =>
              member.organizationId === where.organizationId &&
              (where.role === undefined || member.role === where.role) &&
              (where.status === undefined || member.status === where.status),
          ).length,
      ),
      update: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: { role: OrganizationMember['role'] };
        }) => {
          const found = store.members.find((member) => member.id === where.id);
          if (!found) {
            throw new Error('member not found');
          }
          found.role = data.role;
          found.updatedAt = now;
          return withUser(store, found);
        },
      ),
      delete: jest.fn(async ({ where }: { where: { id: string } }) => {
        const index = store.members.findIndex((member) => member.id === where.id);
        if (index === -1) {
          throw new Error('member not found');
        }
        const [removed] = store.members.splice(index, 1);
        return removed;
      }),
    },
    organizationInvite: {
      findUnique: jest.fn(async ({ where }: { where: { tokenHash: string } }) => {
        const found = store.invites.find((invite) => invite.tokenHash === where.tokenHash);
        return found ? { ...found } : null;
      }),
      updateMany: jest.fn(
        async ({
          where,
          data,
        }: {
          where: {
            organizationId?: string;
            email?: string;
            acceptedAt?: null;
            expiresAt?: { gt: Date };
          };
          data: { expiresAt?: Date; acceptedAt?: Date };
        }) => {
          let count = 0;
          for (const invite of store.invites) {
            if (where.organizationId !== undefined && invite.organizationId !== where.organizationId) {
              continue;
            }
            if (where.email !== undefined && invite.email !== where.email) {
              continue;
            }
            if (where.acceptedAt === null && invite.acceptedAt !== null) {
              continue;
            }
            if (where.expiresAt?.gt && invite.expiresAt <= where.expiresAt.gt) {
              continue;
            }
            if (data.expiresAt !== undefined) {
              invite.expiresAt = data.expiresAt;
            }
            if (data.acceptedAt !== undefined) {
              invite.acceptedAt = data.acceptedAt;
            }
            count += 1;
          }
          return { count };
        },
      ),
    },
    $executeRaw: jest.fn(async () => 1),
    $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => {
      const orgSnap = store.orgs.map((org) => ({ ...org }));
      const memberSnap = store.members.map((member) => ({ ...member }));
      const inviteSnap = store.invites.map((invite) => ({ ...invite }));
      try {
        return await fn(client);
      } catch (err) {
        store.orgs.splice(0, store.orgs.length, ...orgSnap);
        store.members.splice(0, store.members.length, ...memberSnap);
        store.invites.splice(0, store.invites.length, ...inviteSnap);
        throw err;
      }
    }),
  };
  return client as unknown as PrismaClient;
}

function seedOrg(store: MemberStore, overrides: Partial<Organization> & Pick<Organization, 'id' | 'name'>): Organization {
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

function seedMember(
  store: MemberStore,
  overrides: Pick<OrganizationMember, 'organizationId' | 'userId' | 'role' | 'status'> & Partial<OrganizationMember>,
): OrganizationMember {
  const member: OrganizationMember = {
    id: `mem_${++store.ids}`,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
  store.members.push(member);
  return member;
}

function seedUser(store: MemberStore, overrides: Partial<User> = {}): User {
  const user = storedUser(overrides);
  store.users.push(user);
  return user;
}

function seedInvite(
  store: MemberStore,
  overrides: Pick<OrganizationInvite, 'organizationId' | 'email' | 'role' | 'tokenHash' | 'expiresAt'> &
    Partial<OrganizationInvite>,
): OrganizationInvite {
  const invite: OrganizationInvite = {
    id: `inv_${++store.ids}`,
    acceptedAt: null,
    createdAt: now,
    ...overrides,
  };
  store.invites.push(invite);
  return invite;
}

function memberApp(store: MemberStore) {
  const prisma = createFakePrisma(store);
  const userRepository = new UserRepository(prisma);
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
        new OrganizationInviteService(
          new OrganizationRepository(prisma),
          new OrganizationMemberRepository(prisma),
          new OrganizationInviteRepository(prisma),
          userRepository,
          { send: jest.fn(async () => undefined) } as EmailProvider,
          prisma,
        ),
        new OrganizationMemberService(
          new OrganizationRepository(prisma),
          new OrganizationMemberRepository(prisma),
          new OrganizationInviteRepository(prisma),
          prisma,
        ),
      ),
      requireAccessToken: createRequireAccessToken(userRepository),
    }),
  };
}

async function bearer(user: User) {
  return signAccessToken({ sub: user.id, email: user.email, systemRole: user.systemRole });
}

function publicMember(member: OrganizationMember, user: User) {
  return {
    id: member.id,
    organizationId: member.organizationId,
    userId: member.userId,
    role: member.role,
    status: member.status,
    createdAt: member.createdAt.toISOString(),
    updatedAt: member.updatedAt.toISOString(),
    user: publicUser(user),
  };
}

describe('organization members', () => {
  it('lists ACTIVE and PENDING members for an Org Admin with public user fields and page meta', async () => {
    const store: MemberStore = { orgs: [], members: [], invites: [], users: [], ids: 0 };
    seedOrg(store, { id: 'org_a', name: 'Acme' });
    const admin = seedUser(store);
    const pending = seedUser(store, { id: 'user_pending', email: 'pending@example.com', name: 'Pending' });
    const older = seedMember(store, {
      id: 'mem_old',
      organizationId: 'org_a',
      userId: pending.id,
      role: 'TEAM_MEMBER',
      status: 'PENDING',
      createdAt: new Date('2026-08-17T00:00:00.000Z'),
    });
    const newer = seedMember(store, {
      id: 'mem_new',
      organizationId: 'org_a',
      userId: admin.id,
      role: 'ORG_ADMIN',
      status: 'ACTIVE',
      createdAt: new Date('2026-08-18T00:00:00.000Z'),
    });
    seedOrg(store, { id: 'org_b', name: 'Beta' });
    seedMember(store, {
      organizationId: 'org_b',
      userId: admin.id,
      role: 'ORG_ADMIN',
      status: 'ACTIVE',
    });
    const { app } = memberApp(store);
    const token = await bearer(admin);

    const res = await request(app)
      .get('/api/v1/organizations/org_a/members')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body).toEqual({
      success: true,
      data: {
        members: [publicMember(newer, admin), publicMember(older, pending)],
      },
      meta: { page: 1, pageSize: 20, total: 2, totalPages: 1 },
    });
    expect(JSON.stringify(res.body)).not.toContain('secret-hash');
    expect(JSON.stringify(res.body)).not.toContain('sessionEpoch');
    expect(JSON.stringify(res.body)).not.toContain('tokenHash');

    const paged = await request(app)
      .get('/api/v1/organizations/org_a/members?page=2&pageSize=1')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(paged.body.data.members).toEqual([publicMember(older, pending)]);
    expect(paged.body.meta).toEqual({ page: 2, pageSize: 1, total: 2, totalPages: 2 });
  });

  it('forbids list from TM/PM/PENDING/other org/SA without membership and 404s a deleted org', async () => {
    const store: MemberStore = { orgs: [], members: [], invites: [], users: [], ids: 0 };
    seedOrg(store, { id: 'org_a', name: 'Acme' });
    seedOrg(store, { id: 'org_b', name: 'Beta' });
    seedOrg(store, { id: 'org_dead', name: 'Dead', deletedAt: now });
    const adminA = seedUser(store);
    const adminB = seedUser(store, { id: 'user_b', email: 'b@example.com', name: 'B Admin' });
    const tm = seedUser(store, { id: 'user_tm', email: 'tm@example.com', name: 'TM' });
    const pm = seedUser(store, { id: 'user_pm', email: 'pm@example.com', name: 'PM' });
    const pending = seedUser(store, { id: 'user_pending', email: 'pending@example.com', name: 'Pending' });
    const sa = seedUser(store, {
      id: 'user_sa',
      email: 'sa@example.com',
      name: 'SA',
      systemRole: 'SUPER_ADMIN',
    });
    seedMember(store, { organizationId: 'org_a', userId: adminA.id, role: 'ORG_ADMIN', status: 'ACTIVE' });
    seedMember(store, { organizationId: 'org_b', userId: adminB.id, role: 'ORG_ADMIN', status: 'ACTIVE' });
    seedMember(store, { organizationId: 'org_a', userId: tm.id, role: 'TEAM_MEMBER', status: 'ACTIVE' });
    seedMember(store, { organizationId: 'org_a', userId: pm.id, role: 'PROJECT_MANAGER', status: 'ACTIVE' });
    seedMember(store, { organizationId: 'org_a', userId: pending.id, role: 'ORG_ADMIN', status: 'PENDING' });
    const { app } = memberApp(store);

    for (const user of [tm, pm, pending, adminB, sa]) {
      const res = await request(app)
        .get('/api/v1/organizations/org_a/members')
        .set('Authorization', `Bearer ${await bearer(user)}`)
        .expect(403);
      expect(res.body.error.code).toBe('AUTHZ_FORBIDDEN');
      expect(res.body.error.message).toBe(AUTHZ_FORBIDDEN_MESSAGE);
    }

    const gone = await request(app)
      .get('/api/v1/organizations/org_dead/members')
      .set('Authorization', `Bearer ${await bearer(adminA)}`)
      .expect(404);
    expect(gone.body.error.code).toBe('NOT_FOUND');
    expect(gone.body.error.message).toBe(ORGANIZATION_NOT_FOUND_MESSAGE);
  });

  it('patches a member role and uses the new role on the next authorized request', async () => {
    const store: MemberStore = { orgs: [], members: [], invites: [], users: [], ids: 0 };
    seedOrg(store, { id: 'org_a', name: 'Acme' });
    const admin = seedUser(store);
    const second = seedUser(store, { id: 'user_second', email: 'second@example.com', name: 'Second' });
    seedMember(store, { organizationId: 'org_a', userId: admin.id, role: 'ORG_ADMIN', status: 'ACTIVE' });
    const target = seedMember(store, {
      organizationId: 'org_a',
      userId: second.id,
      role: 'ORG_ADMIN',
      status: 'ACTIVE',
    });
    const { app } = memberApp(store);

    const res = await request(app)
      .patch(`/api/v1/organizations/org_a/members/${target.id}`)
      .set('Authorization', `Bearer ${await bearer(admin)}`)
      .send({ role: 'TEAM_MEMBER' })
      .expect(200);

    expect(res.body.data.membership.role).toBe('TEAM_MEMBER');
    expect(store.members.find((member) => member.id === target.id)?.role).toBe('TEAM_MEMBER');
    expect(JSON.stringify(res.body)).not.toContain('secret-hash');

    const forbidden = await request(app)
      .get('/api/v1/organizations/org_a/members')
      .set('Authorization', `Bearer ${await bearer(second)}`)
      .expect(403);
    expect(forbidden.body.error.code).toBe('AUTHZ_FORBIDDEN');
  });

  it('rejects demoting the last ACTIVE ORG_ADMIN with 400 and no mutation', async () => {
    const store: MemberStore = { orgs: [], members: [], invites: [], users: [], ids: 0 };
    seedOrg(store, { id: 'org_a', name: 'Acme' });
    const admin = seedUser(store);
    seedUser(store, { id: 'user_pending_admin', email: 'padmin@example.com', name: 'Pending Admin' });
    const target = seedMember(store, {
      organizationId: 'org_a',
      userId: admin.id,
      role: 'ORG_ADMIN',
      status: 'ACTIVE',
    });
    seedMember(store, {
      organizationId: 'org_a',
      userId: 'user_pending_admin',
      role: 'ORG_ADMIN',
      status: 'PENDING',
    });
    const { app } = memberApp(store);

    const res = await request(app)
      .patch(`/api/v1/organizations/org_a/members/${target.id}`)
      .set('Authorization', `Bearer ${await bearer(admin)}`)
      .send({ role: 'TEAM_MEMBER' })
      .expect(400);

    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toBe(LAST_ACTIVE_ORG_ADMIN_ERROR.message);
    expect(store.members.find((member) => member.id === target.id)?.role).toBe('ORG_ADMIN');
  });

  it('hard-deletes a member, expires unused invites, and 403s later org-scoped calls', async () => {
    const store: MemberStore = { orgs: [], members: [], invites: [], users: [], ids: 0 };
    seedOrg(store, { id: 'org_a', name: 'Acme' });
    const admin = seedUser(store);
    const tm = seedUser(store, { id: 'user_tm', email: 'tm@example.com', name: 'TM' });
    seedMember(store, { organizationId: 'org_a', userId: admin.id, role: 'ORG_ADMIN', status: 'ACTIVE' });
    const target = seedMember(store, {
      organizationId: 'org_a',
      userId: tm.id,
      role: 'TEAM_MEMBER',
      status: 'ACTIVE',
    });
    const live = seedInvite(store, {
      organizationId: 'org_a',
      email: tm.email,
      role: 'TEAM_MEMBER',
      tokenHash: 'hash_live',
      expiresAt: new Date(Date.now() + 60_000),
    });
    const { app } = memberApp(store);

    const res = await request(app)
      .delete(`/api/v1/organizations/org_a/members/${target.id}`)
      .set('Authorization', `Bearer ${await bearer(admin)}`)
      .expect(200);

    expect(res.body.data.membership).toEqual(publicMember(target, tm));
    expect(store.members.find((member) => member.id === target.id)).toBeUndefined();
    expect(store.invites.find((invite) => invite.id === live.id)?.expiresAt.getTime()).toBeLessThanOrEqual(
      Date.now(),
    );
    expect(JSON.stringify(res.body)).not.toContain('secret-hash');

    const later = await request(app)
      .get('/api/v1/organizations/org_a')
      .set('Authorization', `Bearer ${await bearer(tm)}`)
      .expect(403);
    expect(later.body.error.code).toBe('AUTHZ_FORBIDDEN');
  });

  it('rejects removing the last ACTIVE ORG_ADMIN with 400 and leaves the row', async () => {
    const store: MemberStore = { orgs: [], members: [], invites: [], users: [], ids: 0 };
    seedOrg(store, { id: 'org_a', name: 'Acme' });
    const admin = seedUser(store);
    const target = seedMember(store, {
      organizationId: 'org_a',
      userId: admin.id,
      role: 'ORG_ADMIN',
      status: 'ACTIVE',
    });
    const { app } = memberApp(store);

    const res = await request(app)
      .delete(`/api/v1/organizations/org_a/members/${target.id}`)
      .set('Authorization', `Bearer ${await bearer(admin)}`)
      .expect(400);

    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toBe(LAST_ACTIVE_ORG_ADMIN_ERROR.message);
    expect(store.members.find((member) => member.id === target.id)).toEqual(target);
  });

  it('returns 404 for a memberId that belongs to another org and does not mutate', async () => {
    const store: MemberStore = { orgs: [], members: [], invites: [], users: [], ids: 0 };
    seedOrg(store, { id: 'org_a', name: 'Acme' });
    seedOrg(store, { id: 'org_b', name: 'Beta' });
    const adminA = seedUser(store);
    const other = seedUser(store, { id: 'user_b', email: 'b@example.com', name: 'B' });
    seedMember(store, { organizationId: 'org_a', userId: adminA.id, role: 'ORG_ADMIN', status: 'ACTIVE' });
    const foreign = seedMember(store, {
      organizationId: 'org_b',
      userId: other.id,
      role: 'TEAM_MEMBER',
      status: 'ACTIVE',
    });
    const { app } = memberApp(store);

    const patch = await request(app)
      .patch(`/api/v1/organizations/org_a/members/${foreign.id}`)
      .set('Authorization', `Bearer ${await bearer(adminA)}`)
      .send({ role: 'PROJECT_MANAGER' })
      .expect(404);
    expect(patch.body.error.code).toBe('NOT_FOUND');

    const remove = await request(app)
      .delete(`/api/v1/organizations/org_a/members/${foreign.id}`)
      .set('Authorization', `Bearer ${await bearer(adminA)}`)
      .expect(404);
    expect(remove.body.error.code).toBe('NOT_FOUND');
    expect(store.members.find((member) => member.id === foreign.id)?.role).toBe('TEAM_MEMBER');
  });

  it('returns 401 without a valid Bearer token', async () => {
    const store: MemberStore = { orgs: [], members: [], invites: [], users: [], ids: 0 };
    seedOrg(store, { id: 'org_a', name: 'Acme' });
    const { app } = memberApp(store);

    const cases = [
      request(app).get('/api/v1/organizations/org_a/members'),
      request(app).patch('/api/v1/organizations/org_a/members/mem_1').send({ role: 'TEAM_MEMBER' }),
      request(app).delete('/api/v1/organizations/org_a/members/mem_1').set('Authorization', 'Bearer'),
    ];
    for (const pending of cases) {
      const res = await pending.expect(401);
      expect(res.body.error.code).toBe('AUTH_UNAUTHORIZED');
      expect(res.body.error.message).toBe(AUTH_SESSION_UNAUTHORIZED_MESSAGE);
    }
  });

  it('forbids TM/PM mutate and allows removing a PENDING admin when another ACTIVE admin remains', async () => {
    const store: MemberStore = { orgs: [], members: [], invites: [], users: [], ids: 0 };
    seedOrg(store, { id: 'org_a', name: 'Acme' });
    const admin = seedUser(store);
    const tm = seedUser(store, { id: 'user_tm', email: 'tm@example.com', name: 'TM' });
    const pm = seedUser(store, { id: 'user_pm', email: 'pm@example.com', name: 'PM' });
    const pendingAdmin = seedUser(store, { id: 'user_padmin', email: 'padmin@example.com', name: 'PAdmin' });
    seedMember(store, { organizationId: 'org_a', userId: admin.id, role: 'ORG_ADMIN', status: 'ACTIVE' });
    const tmMember = seedMember(store, {
      organizationId: 'org_a',
      userId: tm.id,
      role: 'TEAM_MEMBER',
      status: 'ACTIVE',
    });
    seedMember(store, {
      organizationId: 'org_a',
      userId: pm.id,
      role: 'PROJECT_MANAGER',
      status: 'ACTIVE',
    });
    const pendingMember = seedMember(store, {
      organizationId: 'org_a',
      userId: pendingAdmin.id,
      role: 'ORG_ADMIN',
      status: 'PENDING',
    });
    const { app } = memberApp(store);

    for (const user of [tm, pm]) {
      const forbidden = await request(app)
        .patch(`/api/v1/organizations/org_a/members/${pendingMember.id}`)
        .set('Authorization', `Bearer ${await bearer(user)}`)
        .send({ role: 'TEAM_MEMBER' })
        .expect(403);
      expect(forbidden.body.error.code).toBe('AUTHZ_FORBIDDEN');
      const forbiddenDelete = await request(app)
        .delete(`/api/v1/organizations/org_a/members/${pendingMember.id}`)
        .set('Authorization', `Bearer ${await bearer(user)}`)
        .expect(403);
      expect(forbiddenDelete.body.error.code).toBe('AUTHZ_FORBIDDEN');
    }
    expect(store.members.find((member) => member.id === pendingMember.id)?.role).toBe('ORG_ADMIN');

    await request(app)
      .delete(`/api/v1/organizations/org_a/members/${pendingMember.id}`)
      .set('Authorization', `Bearer ${await bearer(admin)}`)
      .expect(200);
    expect(store.members.find((member) => member.id === pendingMember.id)).toBeUndefined();
    expect(store.members.find((member) => member.id === tmMember.id)).toBeDefined();
  });

  it('allows self-demote and removing another ACTIVE admin when a second ACTIVE admin remains', async () => {
    const store: MemberStore = { orgs: [], members: [], invites: [], users: [], ids: 0 };
    seedOrg(store, { id: 'org_a', name: 'Acme' });
    const admin = seedUser(store);
    const second = seedUser(store, { id: 'user_second', email: 'second@example.com', name: 'Second' });
    const selfMember = seedMember(store, {
      organizationId: 'org_a',
      userId: admin.id,
      role: 'ORG_ADMIN',
      status: 'ACTIVE',
    });
    const otherAdmin = seedMember(store, {
      organizationId: 'org_a',
      userId: second.id,
      role: 'ORG_ADMIN',
      status: 'ACTIVE',
    });
    const { app } = memberApp(store);

    const selfPatch = await request(app)
      .patch(`/api/v1/organizations/org_a/members/${selfMember.id}`)
      .set('Authorization', `Bearer ${await bearer(admin)}`)
      .send({ role: 'PROJECT_MANAGER' })
      .expect(200);
    expect(selfPatch.body.data.membership.role).toBe('PROJECT_MANAGER');
    expect(store.members.find((member) => member.id === selfMember.id)?.role).toBe('PROJECT_MANAGER');

    await request(app)
      .delete(`/api/v1/organizations/org_a/members/${selfMember.id}`)
      .set('Authorization', `Bearer ${await bearer(second)}`)
      .expect(200);
    expect(store.members.find((member) => member.id === selfMember.id)).toBeUndefined();
    expect(store.members.find((member) => member.id === otherAdmin.id)?.role).toBe('ORG_ADMIN');
  });

  it('rejects demoting the last ACTIVE ORG_ADMIN to PROJECT_MANAGER', async () => {
    const store: MemberStore = { orgs: [], members: [], invites: [], users: [], ids: 0 };
    seedOrg(store, { id: 'org_a', name: 'Acme' });
    const admin = seedUser(store);
    const target = seedMember(store, {
      organizationId: 'org_a',
      userId: admin.id,
      role: 'ORG_ADMIN',
      status: 'ACTIVE',
    });
    const { app } = memberApp(store);

    const res = await request(app)
      .patch(`/api/v1/organizations/org_a/members/${target.id}`)
      .set('Authorization', `Bearer ${await bearer(admin)}`)
      .send({ role: 'PROJECT_MANAGER' })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(store.members.find((member) => member.id === target.id)?.role).toBe('ORG_ADMIN');
  });

  it('updates PENDING member role only and 404s missing memberId, deleted org, and mutate authz', async () => {
    const store: MemberStore = { orgs: [], members: [], invites: [], users: [], ids: 0 };
    seedOrg(store, { id: 'org_a', name: 'Acme' });
    seedOrg(store, { id: 'org_b', name: 'Beta' });
    seedOrg(store, { id: 'org_dead', name: 'Dead', deletedAt: now });
    const admin = seedUser(store);
    const pending = seedUser(store, { id: 'user_pending', email: 'pending@example.com', name: 'Pending' });
    const sa = seedUser(store, {
      id: 'user_sa',
      email: 'sa@example.com',
      name: 'SA',
      systemRole: 'SUPER_ADMIN',
    });
    const adminB = seedUser(store, { id: 'user_b', email: 'b@example.com', name: 'B' });
    seedMember(store, { organizationId: 'org_a', userId: admin.id, role: 'ORG_ADMIN', status: 'ACTIVE' });
    seedMember(store, { organizationId: 'org_b', userId: adminB.id, role: 'ORG_ADMIN', status: 'ACTIVE' });
    const pendingMember = seedMember(store, {
      organizationId: 'org_a',
      userId: pending.id,
      role: 'TEAM_MEMBER',
      status: 'PENDING',
    });
    const { app } = memberApp(store);

    const patched = await request(app)
      .patch(`/api/v1/organizations/org_a/members/${pendingMember.id}`)
      .set('Authorization', `Bearer ${await bearer(admin)}`)
      .send({ role: 'PROJECT_MANAGER' })
      .expect(200);
    expect(patched.body.data.membership).toMatchObject({
      role: 'PROJECT_MANAGER',
      status: 'PENDING',
    });
    expect(store.members.find((member) => member.id === pendingMember.id)?.status).toBe('PENDING');

    const missing = await request(app)
      .delete('/api/v1/organizations/org_a/members/mem_missing')
      .set('Authorization', `Bearer ${await bearer(admin)}`)
      .expect(404);
    expect(missing.body.error.code).toBe('NOT_FOUND');

    for (const method of ['patch', 'delete'] as const) {
      const req =
        method === 'patch'
          ? request(app).patch('/api/v1/organizations/org_dead/members/mem_x').send({ role: 'TEAM_MEMBER' })
          : request(app).delete('/api/v1/organizations/org_dead/members/mem_x');
      const gone = await req.set('Authorization', `Bearer ${await bearer(admin)}`).expect(404);
      expect(gone.body.error.code).toBe('NOT_FOUND');
    }

    for (const user of [sa, pending, adminB]) {
      const forbidden = await request(app)
        .patch(`/api/v1/organizations/org_a/members/${pendingMember.id}`)
        .set('Authorization', `Bearer ${await bearer(user)}`)
        .send({ role: 'TEAM_MEMBER' })
        .expect(403);
      expect(forbidden.body.error.code).toBe('AUTHZ_FORBIDDEN');
    }

    const invalid = await request(app)
      .patch(`/api/v1/organizations/org_a/members/${pendingMember.id}`)
      .set('Authorization', `Bearer ${await bearer(admin)}`)
      .send({ role: 'OWNER' })
      .expect(400);
    expect(invalid.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects accept after remove because unused invites are expired', async () => {
    const store: MemberStore = { orgs: [], members: [], invites: [], users: [], ids: 0 };
    seedOrg(store, { id: 'org_a', name: 'Acme' });
    const admin = seedUser(store);
    const invitee = seedUser(store, { id: 'user_invitee', email: 'join@example.com', name: 'Join' });
    seedMember(store, { organizationId: 'org_a', userId: admin.id, role: 'ORG_ADMIN', status: 'ACTIVE' });
    const target = seedMember(store, {
      organizationId: 'org_a',
      userId: invitee.id,
      role: 'TEAM_MEMBER',
      status: 'PENDING',
    });
    const raw = 'a'.repeat(64);
    seedInvite(store, {
      organizationId: 'org_a',
      email: invitee.email,
      role: 'TEAM_MEMBER',
      tokenHash: hashToken(raw),
      expiresAt: new Date(Date.now() + 60_000),
    });
    const { app } = memberApp(store);

    await request(app)
      .delete(`/api/v1/organizations/org_a/members/${target.id}`)
      .set('Authorization', `Bearer ${await bearer(admin)}`)
      .expect(200);

    const accept = await request(app)
      .post('/api/v1/organizations/org_a/members/accept')
      .set('Authorization', `Bearer ${await bearer(invitee)}`)
      .send({ token: raw })
      .expect(400);
    expect(accept.body.error.code).toBe('AUTH_TOKEN_INVALID');
    expect(accept.body.error.message).toBe(ORG_INVITE_TOKEN_INVALID_MESSAGE);
    expect(store.members.find((member) => member.userId === invitee.id)).toBeUndefined();
  });
});

describe('OrganizationMemberRepository.lockForMemberWrite', () => {
  it('acquires a transaction-scoped advisory lock keyed by organization id', async () => {
    const executeRaw = jest.fn<(strings: readonly string[], ...values: unknown[]) => Promise<number>>(
      async () => 1,
    );
    const prisma = { $executeRaw: executeRaw } as unknown as PrismaClient;
    const repo = new OrganizationMemberRepository(prisma);

    await repo.lockForMemberWrite('org_a');

    expect(executeRaw).toHaveBeenCalledTimes(1);
    const call = executeRaw.mock.calls[0];
    expect(call).toBeDefined();
    const [strings, ...values] = call ?? [];
    expect((strings ?? []).join('')).toContain('pg_advisory_xact_lock(hashtext(');
    expect(values).toEqual(['org-members:org_a']);
  });
});
