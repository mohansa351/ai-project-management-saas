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
import { env } from './config/env.js';
import { AuthController } from './controllers/authController.js';
import { HealthController } from './controllers/healthController.js';
import { OrganizationController } from './controllers/organizationController.js';
import { dummyProjectController } from './controllers/projectController.js';
import type { EmailProvider } from './lib/email/emailProvider.js';
import { AUTH_SESSION_UNAUTHORIZED_MESSAGE } from './lib/http/authErrors.js';
import {
  ALREADY_ACTIVE_MEMBER_ERROR,
  AUTHZ_FORBIDDEN_MESSAGE,
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

type InviteStore = {
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

function createFakePrisma(store: InviteStore): PrismaClient {
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
      create: jest.fn(
        async ({
          data,
        }: {
          data: {
            organizationId: string;
            userId: string;
            role: OrganizationMember['role'];
            status: OrganizationMember['status'];
          };
        }) => {
          const member: OrganizationMember = {
            id: `mem_${++store.ids}`,
            organizationId: data.organizationId,
            userId: data.userId,
            role: data.role,
            status: data.status,
            createdAt: now,
            updatedAt: now,
          };
          store.members.push(member);
          return { ...member };
        },
      ),
      updateMany: jest.fn(
        async ({
          where,
          data,
        }: {
          where: {
            organizationId: string;
            userId: string;
            status?: OrganizationMember['status'] | { not: OrganizationMember['status'] };
          };
          data: { role?: OrganizationMember['role']; status?: OrganizationMember['status'] };
        }) => {
          let count = 0;
          for (const member of store.members) {
            if (member.organizationId !== where.organizationId || member.userId !== where.userId) {
              continue;
            }
            if (where.status !== undefined) {
              if (typeof where.status === 'string' && member.status !== where.status) {
                continue;
              }
              if (typeof where.status === 'object' && member.status === where.status.not) {
                continue;
              }
            }
            if (data.role !== undefined) {
              member.role = data.role;
            }
            if (data.status !== undefined) {
              member.status = data.status;
            }
            member.updatedAt = now;
            count += 1;
          }
          return { count };
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
    organizationInvite: {
      create: jest.fn(
        async ({
          data,
        }: {
          data: {
            organizationId: string;
            email: string;
            role: OrganizationInvite['role'];
            tokenHash: string;
            expiresAt: Date;
          };
        }) => {
          const invite: OrganizationInvite = {
            id: `inv_${++store.ids}`,
            organizationId: data.organizationId,
            email: data.email,
            role: data.role,
            tokenHash: data.tokenHash,
            expiresAt: data.expiresAt,
            acceptedAt: null,
            createdAt: now,
          };
          store.invites.push(invite);
          return { ...invite };
        },
      ),
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
            id?: string;
            organizationId?: string;
            email?: string;
            acceptedAt?: null;
            expiresAt?: { gt: Date };
          };
          data: { expiresAt?: Date; acceptedAt?: Date };
        }) => {
          let count = 0;
          for (const invite of store.invites) {
            if (where.id !== undefined && invite.id !== where.id) {
              continue;
            }
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

function seedOrg(store: InviteStore, overrides: Partial<Organization> & Pick<Organization, 'id' | 'name'>): Organization {
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
  store: InviteStore,
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

function seedUser(store: InviteStore, overrides: Partial<User> = {}): User {
  const user = storedUser(overrides);
  store.users.push(user);
  return user;
}

function seedInvite(
  store: InviteStore,
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

function inviteApp(store: InviteStore, send: EmailProvider['send'] = jest.fn(async () => undefined)) {
  const prisma = createFakePrisma(store);
  const userRepository = new UserRepository(prisma);
  return {
    store,
    prisma,
    send: send as jest.Mock<EmailProvider['send']>,
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
          { send },
          prisma,
        ),
        new OrganizationMemberService(
          new OrganizationRepository(prisma),
          new OrganizationMemberRepository(prisma),
          new OrganizationInviteRepository(prisma),
          prisma,
        ),
      ),
      projectController: dummyProjectController(),
      requireAccessToken: createRequireAccessToken(userRepository),
    }),
  };
}

async function bearer(user: User) {
  return signAccessToken({ sub: user.id, email: user.email, systemRole: user.systemRole });
}

function extractAcceptToken(body: string): string {
  const match = body.match(/token=([a-f0-9]{64})/);
  if (!match?.[1]) {
    throw new Error('token missing from mail body');
  }
  return match[1];
}

function liveInvites(store: InviteStore, email: string, organizationId = 'org_a'): OrganizationInvite[] {
  return store.invites.filter(
    (invite) =>
      invite.organizationId === organizationId &&
      invite.email === email &&
      invite.acceptedAt === null &&
      invite.expiresAt > new Date(),
  );
}

describe('organization invites', () => {
  it('invites an existing non-ACTIVE user: hashed TTL token, PENDING member, and organization_invite mail', async () => {
    const store: InviteStore = { orgs: [], members: [], invites: [], users: [], ids: 0 };
    seedOrg(store, { id: 'org_a', name: 'Acme' });
    const admin = seedUser(store);
    const invitee = seedUser(store, { id: 'user_invitee', email: 'join@example.com', name: 'Join Me' });
    seedMember(store, { organizationId: 'org_a', userId: admin.id, role: 'ORG_ADMIN', status: 'ACTIVE' });
    const send = jest.fn<EmailProvider['send']>(async () => undefined);
    const { app } = inviteApp(store, send);
    const token = await bearer(admin);
    const before = Date.now();

    const res = await request(app)
      .post('/api/v1/organizations/org_a/members/invite')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: '  Join@Example.com  ', role: 'TEAM_MEMBER' })
      .expect(201);

    const invite = store.invites[0];
    expect(invite).toBeDefined();
    expect(res.body).toEqual({
      success: true,
      data: {
        invite: {
          id: invite?.id,
          organizationId: 'org_a',
          email: 'join@example.com',
          role: 'TEAM_MEMBER',
          expiresAt: invite?.expiresAt.toISOString(),
          createdAt: now.toISOString(),
        },
      },
    });
    expect(res.body.data.invite).not.toHaveProperty('tokenHash');
    expect(invite?.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(invite?.expiresAt.getTime()).toBeGreaterThanOrEqual(before + env.ORG_INVITE_TOKEN_TTL_MINUTES * 60_000 - 50);
    expect(invite?.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + env.ORG_INVITE_TOKEN_TTL_MINUTES * 60_000 + 50);
    expect(store.members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          organizationId: 'org_a',
          userId: invitee.id,
          role: 'TEAM_MEMBER',
          status: 'PENDING',
        }),
      ]),
    );
    expect(send).toHaveBeenCalledTimes(1);
    const message = send.mock.calls[0]?.[0];
    expect(message?.type).toBe('organization_invite');
    expect(message?.to).toBe('join@example.com');
    const raw = extractAcceptToken(message?.body ?? '');
    expect(invite?.tokenHash).toBe(hashToken(raw));
    expect(message?.body).toContain(
      `${env.CORS_ORIGIN}/accept-invite?organizationId=${encodeURIComponent('org_a')}&token=${encodeURIComponent(raw)}`,
    );
  });

  it('still returns 201 when send throws after persist', async () => {
    const store: InviteStore = { orgs: [], members: [], invites: [], users: [], ids: 0 };
    seedOrg(store, { id: 'org_a', name: 'Acme' });
    const admin = seedUser(store);
    seedUser(store, { id: 'user_invitee', email: 'join@example.com' });
    seedMember(store, { organizationId: 'org_a', userId: admin.id, role: 'ORG_ADMIN', status: 'ACTIVE' });
    const send = jest.fn<EmailProvider['send']>(async () => {
      throw new Error('smtp down');
    });
    const { app } = inviteApp(store, send);
    const token = await bearer(admin);

    await request(app)
      .post('/api/v1/organizations/org_a/members/invite')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'join@example.com', role: 'PROJECT_MANAGER' })
      .expect(201);

    expect(store.invites).toHaveLength(1);
    expect(store.members.some((member) => member.userId === 'user_invitee' && member.status === 'PENDING')).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('invites an unknown email with an invite row only', async () => {
    const store: InviteStore = { orgs: [], members: [], invites: [], users: [], ids: 0 };
    seedOrg(store, { id: 'org_a', name: 'Acme' });
    const admin = seedUser(store);
    seedMember(store, { organizationId: 'org_a', userId: admin.id, role: 'ORG_ADMIN', status: 'ACTIVE' });
    const send = jest.fn<EmailProvider['send']>(async () => undefined);
    const { app } = inviteApp(store, send);
    const token = await bearer(admin);

    await request(app)
      .post('/api/v1/organizations/org_a/members/invite')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'nobody@example.com', role: 'TEAM_MEMBER' })
      .expect(201);

    expect(store.invites).toHaveLength(1);
    expect(store.invites[0]?.email).toBe('nobody@example.com');
    expect(store.members.filter((member) => member.userId !== admin.id)).toHaveLength(0);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('rejects inviting an already-ACTIVE member with 400 and no token or mail', async () => {
    const store: InviteStore = { orgs: [], members: [], invites: [], users: [], ids: 0 };
    seedOrg(store, { id: 'org_a', name: 'Acme' });
    const admin = seedUser(store);
    const member = seedUser(store, { id: 'user_active', email: 'active@example.com' });
    seedMember(store, { organizationId: 'org_a', userId: admin.id, role: 'ORG_ADMIN', status: 'ACTIVE' });
    seedMember(store, { organizationId: 'org_a', userId: member.id, role: 'TEAM_MEMBER', status: 'ACTIVE' });
    const send = jest.fn<EmailProvider['send']>(async () => undefined);
    const { app } = inviteApp(store, send);
    const token = await bearer(admin);

    const res = await request(app)
      .post('/api/v1/organizations/org_a/members/invite')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'active@example.com', role: 'PROJECT_MANAGER' })
      .expect(400);

    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toBe(ALREADY_ACTIVE_MEMBER_ERROR.message);
    expect(store.invites).toHaveLength(0);
    expect(send).not.toHaveBeenCalled();
  });

  it('expires a prior unused invite for the same org+email and issues one live token', async () => {
    const store: InviteStore = { orgs: [], members: [], invites: [], users: [], ids: 0 };
    seedOrg(store, { id: 'org_a', name: 'Acme' });
    const admin = seedUser(store);
    seedMember(store, { organizationId: 'org_a', userId: admin.id, role: 'ORG_ADMIN', status: 'ACTIVE' });
    const prior = seedInvite(store, {
      organizationId: 'org_a',
      email: 'nobody@example.com',
      role: 'TEAM_MEMBER',
      tokenHash: hashToken('a'.repeat(64)),
      expiresAt: new Date(Date.now() + 60_000),
    });
    const send = jest.fn<EmailProvider['send']>(async () => undefined);
    const { app } = inviteApp(store, send);
    const token = await bearer(admin);

    await request(app)
      .post('/api/v1/organizations/org_a/members/invite')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'nobody@example.com', role: 'TEAM_MEMBER' })
      .expect(201);

    expect(store.invites.find((invite) => invite.id === prior.id)?.expiresAt.getTime()).toBeLessThanOrEqual(Date.now());
    expect(liveInvites(store, 'nobody@example.com')).toHaveLength(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('returns 403 for TM/PM/PENDING/other-org and SUPER_ADMIN without membership, and 404 for deleted orgs', async () => {
    const store: InviteStore = { orgs: [], members: [], invites: [], users: [], ids: 0 };
    seedOrg(store, { id: 'org_a', name: 'Acme' });
    seedOrg(store, { id: 'org_b', name: 'Beta' });
    seedOrg(store, { id: 'org_gone', name: 'Gone', deletedAt: now });
    const adminA = seedUser(store);
    const tm = seedUser(store, { id: 'user_tm', email: 'tm@example.com' });
    const pm = seedUser(store, { id: 'user_pm', email: 'pm@example.com' });
    const pending = seedUser(store, { id: 'user_pending', email: 'pending@example.com' });
    const sa = seedUser(store, {
      id: 'user_sa',
      email: 'sa@example.com',
      systemRole: 'SUPER_ADMIN',
    });
    const otherAdmin = seedUser(store, { id: 'user_other', email: 'other-admin@example.com' });
    seedMember(store, { organizationId: 'org_a', userId: adminA.id, role: 'ORG_ADMIN', status: 'ACTIVE' });
    seedMember(store, { organizationId: 'org_a', userId: tm.id, role: 'TEAM_MEMBER', status: 'ACTIVE' });
    seedMember(store, { organizationId: 'org_a', userId: pm.id, role: 'PROJECT_MANAGER', status: 'ACTIVE' });
    seedMember(store, { organizationId: 'org_a', userId: pending.id, role: 'ORG_ADMIN', status: 'PENDING' });
    seedMember(store, { organizationId: 'org_b', userId: otherAdmin.id, role: 'ORG_ADMIN', status: 'ACTIVE' });
    const send = jest.fn<EmailProvider['send']>(async () => undefined);
    const { app } = inviteApp(store, send);
    const invitesBefore = store.invites.length;

    const forbiddenCallers = [tm, pm, pending, sa, otherAdmin];
    for (const caller of forbiddenCallers) {
      const res = await request(app)
        .post('/api/v1/organizations/org_a/members/invite')
        .set('Authorization', `Bearer ${await bearer(caller)}`)
        .send({ email: 'new@example.com', role: 'TEAM_MEMBER' })
        .expect(403);
      expect(res.body.error.code).toBe('AUTHZ_FORBIDDEN');
      expect(res.body.error.message).toBe(AUTHZ_FORBIDDEN_MESSAGE);
    }

    const gone = await request(app)
      .post('/api/v1/organizations/org_gone/members/invite')
      .set('Authorization', `Bearer ${await bearer(adminA)}`)
      .send({ email: 'new@example.com', role: 'TEAM_MEMBER' })
      .expect(404);
    expect(gone.body.error.code).toBe('NOT_FOUND');
    expect(gone.body.error.message).toBe(ORGANIZATION_NOT_FOUND_MESSAGE);

    const missing = await request(app)
      .post('/api/v1/organizations/missing/members/invite')
      .set('Authorization', `Bearer ${await bearer(adminA)}`)
      .send({ email: 'new@example.com', role: 'TEAM_MEMBER' })
      .expect(404);
    expect(missing.body.error.code).toBe('NOT_FOUND');
    expect(store.invites).toHaveLength(invitesBefore);
  });

  it('accepts a matching Bearer + valid token: ACTIVE membership and spent token', async () => {
    const store: InviteStore = { orgs: [], members: [], invites: [], users: [], ids: 0 };
    seedOrg(store, { id: 'org_a', name: 'Acme' });
    const admin = seedUser(store);
    const invitee = seedUser(store, { id: 'user_invitee', email: 'join@example.com' });
    seedMember(store, { organizationId: 'org_a', userId: admin.id, role: 'ORG_ADMIN', status: 'ACTIVE' });
    const send = jest.fn<EmailProvider['send']>(async () => undefined);
    const { app } = inviteApp(store, send);

    await request(app)
      .post('/api/v1/organizations/org_a/members/invite')
      .set('Authorization', `Bearer ${await bearer(admin)}`)
      .send({ email: 'join@example.com', role: 'TEAM_MEMBER' })
      .expect(201);

    const raw = extractAcceptToken(send.mock.calls[0]?.[0]?.body ?? '');
    const res = await request(app)
      .post('/api/v1/organizations/org_a/members/accept')
      .set('Authorization', `Bearer ${await bearer(invitee)}`)
      .send({ token: raw })
      .expect(200);

    expect(res.body).toEqual({
      success: true,
      data: {
        membership: { organizationId: 'org_a', role: 'TEAM_MEMBER', status: 'ACTIVE' },
      },
    });
    expect(store.members.find((member) => member.userId === invitee.id)?.status).toBe('ACTIVE');
    expect(store.invites[0]?.acceptedAt).toBeInstanceOf(Date);

    const reuse = await request(app)
      .post('/api/v1/organizations/org_a/members/accept')
      .set('Authorization', `Bearer ${await bearer(invitee)}`)
      .send({ token: raw })
      .expect(400);
    expect(reuse.body.error.code).toBe('AUTH_TOKEN_INVALID');
    expect(reuse.body.error.message).toBe(ORG_INVITE_TOKEN_INVALID_MESSAGE);
  });

  it('returns 400 AUTH_TOKEN_INVALID for garbage, expired, reused, and wrong-org tokens without membership change', async () => {
    const store: InviteStore = { orgs: [], members: [], invites: [], users: [], ids: 0 };
    seedOrg(store, { id: 'org_a', name: 'Acme' });
    seedOrg(store, { id: 'org_b', name: 'Beta' });
    const invitee = seedUser(store, { id: 'user_invitee', email: 'join@example.com' });
    const liveHash = hashToken('b'.repeat(64));
    const expiredHash = hashToken('c'.repeat(64));
    const reusedHash = hashToken('d'.repeat(64));
    const otherOrgHash = hashToken('e'.repeat(64));
    seedInvite(store, {
      organizationId: 'org_a',
      email: 'join@example.com',
      role: 'TEAM_MEMBER',
      tokenHash: liveHash,
      expiresAt: new Date(Date.now() + 60_000),
    });
    seedInvite(store, {
      organizationId: 'org_a',
      email: 'join@example.com',
      role: 'TEAM_MEMBER',
      tokenHash: expiredHash,
      expiresAt: new Date(Date.now() - 1000),
    });
    seedInvite(store, {
      organizationId: 'org_a',
      email: 'join@example.com',
      role: 'TEAM_MEMBER',
      tokenHash: reusedHash,
      expiresAt: new Date(Date.now() + 60_000),
      acceptedAt: now,
    });
    seedInvite(store, {
      organizationId: 'org_b',
      email: 'join@example.com',
      role: 'TEAM_MEMBER',
      tokenHash: otherOrgHash,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const { app } = inviteApp(store);
    const auth = await bearer(invitee);

    const cases = [
      { token: 'not-a-real-token' },
      { token: 'c'.repeat(64) },
      { token: 'd'.repeat(64) },
      { token: 'e'.repeat(64) },
    ];
    for (const body of cases) {
      const res = await request(app)
        .post('/api/v1/organizations/org_a/members/accept')
        .set('Authorization', `Bearer ${auth}`)
        .send(body)
        .expect(400);
      expect(res.body.error.code).toBe('AUTH_TOKEN_INVALID');
    }
    expect(store.members.filter((member) => member.userId === invitee.id)).toHaveLength(0);
    expect(store.invites.find((invite) => invite.tokenHash === otherOrgHash)?.acceptedAt).toBeNull();
    expect(store.invites.find((invite) => invite.tokenHash === liveHash)?.acceptedAt).toBeNull();
  });

  it('returns 403 when another account accepts a valid token and leaves the token unused', async () => {
    const store: InviteStore = { orgs: [], members: [], invites: [], users: [], ids: 0 };
    seedOrg(store, { id: 'org_a', name: 'Acme' });
    const other = seedUser(store, { id: 'user_other', email: 'other@example.com' });
    const liveHash = hashToken('f'.repeat(64));
    seedInvite(store, {
      organizationId: 'org_a',
      email: 'join@example.com',
      role: 'TEAM_MEMBER',
      tokenHash: liveHash,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const { app } = inviteApp(store);

    const res = await request(app)
      .post('/api/v1/organizations/org_a/members/accept')
      .set('Authorization', `Bearer ${await bearer(other)}`)
      .send({ token: 'f'.repeat(64) })
      .expect(403);
    expect(res.body.error.code).toBe('AUTHZ_FORBIDDEN');
    expect(store.invites.find((invite) => invite.tokenHash === liveHash)?.acceptedAt).toBeNull();
    expect(store.members).toHaveLength(0);
  });

  it('returns 401 AUTH_UNAUTHORIZED without a valid Bearer token', async () => {
    const store: InviteStore = { orgs: [], members: [], invites: [], users: [], ids: 0 };
    seedOrg(store, { id: 'org_a', name: 'Acme' });
    const { app } = inviteApp(store);

    const invite = await request(app)
      .post('/api/v1/organizations/org_a/members/invite')
      .send({ email: 'join@example.com', role: 'TEAM_MEMBER' })
      .expect(401);
    expect(invite.body.error.code).toBe('AUTH_UNAUTHORIZED');
    expect(invite.body.error.message).toBe(AUTH_SESSION_UNAUTHORIZED_MESSAGE);

    const accept = await request(app)
      .post('/api/v1/organizations/org_a/members/accept')
      .set('Authorization', 'Bearer')
      .send({ token: 'a'.repeat(64) })
      .expect(401);
    expect(accept.body.error.code).toBe('AUTH_UNAUTHORIZED');
    expect(store.invites).toHaveLength(0);
  });

  it('creates ACTIVE membership when an unknown invitee registers then accepts', async () => {
    const store: InviteStore = { orgs: [], members: [], invites: [], users: [], ids: 0 };
    seedOrg(store, { id: 'org_a', name: 'Acme' });
    const admin = seedUser(store);
    seedMember(store, { organizationId: 'org_a', userId: admin.id, role: 'ORG_ADMIN', status: 'ACTIVE' });
    const send = jest.fn<EmailProvider['send']>(async () => undefined);
    const { app } = inviteApp(store, send);

    await request(app)
      .post('/api/v1/organizations/org_a/members/invite')
      .set('Authorization', `Bearer ${await bearer(admin)}`)
      .send({ email: 'nobody@example.com', role: 'TEAM_MEMBER' })
      .expect(201);

    expect(store.members.filter((member) => member.userId !== admin.id)).toHaveLength(0);
    const invitee = seedUser(store, { id: 'user_new', email: 'nobody@example.com', name: 'New User' });
    const raw = extractAcceptToken(send.mock.calls[0]?.[0]?.body ?? '');

    const res = await request(app)
      .post('/api/v1/organizations/org_a/members/accept')
      .set('Authorization', `Bearer ${await bearer(invitee)}`)
      .send({ token: `  ${raw}  ` })
      .expect(200);

    expect(res.body.data.membership).toEqual({
      organizationId: 'org_a',
      role: 'TEAM_MEMBER',
      status: 'ACTIVE',
    });
    expect(store.members.find((member) => member.userId === invitee.id)).toEqual(
      expect.objectContaining({
        organizationId: 'org_a',
        userId: invitee.id,
        role: 'TEAM_MEMBER',
        status: 'ACTIVE',
      }),
    );
    expect(store.invites[0]?.acceptedAt).toBeInstanceOf(Date);
  });

  it('re-invites an existing PENDING member with a new role and leaves them PENDING', async () => {
    const store: InviteStore = { orgs: [], members: [], invites: [], users: [], ids: 0 };
    seedOrg(store, { id: 'org_a', name: 'Acme' });
    const admin = seedUser(store);
    const pending = seedUser(store, { id: 'user_pending', email: 'pending@example.com' });
    seedMember(store, { organizationId: 'org_a', userId: admin.id, role: 'ORG_ADMIN', status: 'ACTIVE' });
    seedMember(store, { organizationId: 'org_a', userId: pending.id, role: 'TEAM_MEMBER', status: 'PENDING' });
    const prior = seedInvite(store, {
      organizationId: 'org_a',
      email: 'pending@example.com',
      role: 'TEAM_MEMBER',
      tokenHash: hashToken('a'.repeat(64)),
      expiresAt: new Date(Date.now() + 60_000),
    });
    const send = jest.fn<EmailProvider['send']>(async () => undefined);
    const { app } = inviteApp(store, send);

    await request(app)
      .post('/api/v1/organizations/org_a/members/invite')
      .set('Authorization', `Bearer ${await bearer(admin)}`)
      .send({ email: 'pending@example.com', role: 'PROJECT_MANAGER' })
      .expect(201);

    expect(store.invites.find((invite) => invite.id === prior.id)?.expiresAt.getTime()).toBeLessThanOrEqual(Date.now());
    expect(liveInvites(store, 'pending@example.com')).toHaveLength(1);
    expect(liveInvites(store, 'pending@example.com')[0]?.role).toBe('PROJECT_MANAGER');
    expect(store.members.find((member) => member.userId === pending.id)).toEqual(
      expect.objectContaining({
        userId: pending.id,
        role: 'PROJECT_MANAGER',
        status: 'PENDING',
      }),
    );
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('returns 400 VALIDATION_ERROR for invalid invite/accept bodies without writes', async () => {
    const store: InviteStore = { orgs: [], members: [], invites: [], users: [], ids: 0 };
    seedOrg(store, { id: 'org_a', name: 'Acme' });
    const admin = seedUser(store);
    const invitee = seedUser(store, { id: 'user_invitee', email: 'join@example.com' });
    seedMember(store, { organizationId: 'org_a', userId: admin.id, role: 'ORG_ADMIN', status: 'ACTIVE' });
    const { app } = inviteApp(store);
    const adminToken = await bearer(admin);
    const inviteeToken = await bearer(invitee);
    const membersBefore = store.members.length;

    const invalidEmail = await request(app)
      .post('/api/v1/organizations/org_a/members/invite')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: 'not-an-email', role: 'TEAM_MEMBER' })
      .expect(400);
    expect(invalidEmail.body.error.code).toBe('VALIDATION_ERROR');

    const invalidRole = await request(app)
      .post('/api/v1/organizations/org_a/members/invite')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: 'join@example.com', role: 'HACKER' })
      .expect(400);
    expect(invalidRole.body.error.code).toBe('VALIDATION_ERROR');

    const missingRole = await request(app)
      .post('/api/v1/organizations/org_a/members/invite')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: 'join@example.com' })
      .expect(400);
    expect(missingRole.body.error.code).toBe('VALIDATION_ERROR');

    const emptyToken = await request(app)
      .post('/api/v1/organizations/org_a/members/accept')
      .set('Authorization', `Bearer ${inviteeToken}`)
      .send({ token: '' })
      .expect(400);
    expect(emptyToken.body.error.code).toBe('VALIDATION_ERROR');

    const whitespaceToken = await request(app)
      .post('/api/v1/organizations/org_a/members/accept')
      .set('Authorization', `Bearer ${inviteeToken}`)
      .send({ token: '   ' })
      .expect(400);
    expect(whitespaceToken.body.error.code).toBe('VALIDATION_ERROR');

    expect(store.invites).toHaveLength(0);
    expect(store.members).toHaveLength(membersBefore);
  });

  it('returns 404 NOT_FOUND when accepting against a soft-deleted org and leaves the token unused', async () => {
    const store: InviteStore = { orgs: [], members: [], invites: [], users: [], ids: 0 };
    seedOrg(store, { id: 'org_a', name: 'Acme', deletedAt: now });
    const invitee = seedUser(store, { id: 'user_invitee', email: 'join@example.com' });
    const liveHash = hashToken('g'.repeat(64));
    seedInvite(store, {
      organizationId: 'org_a',
      email: 'join@example.com',
      role: 'TEAM_MEMBER',
      tokenHash: liveHash,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const { app } = inviteApp(store);

    const res = await request(app)
      .post('/api/v1/organizations/org_a/members/accept')
      .set('Authorization', `Bearer ${await bearer(invitee)}`)
      .send({ token: 'g'.repeat(64) })
      .expect(404);

    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.message).toBe(ORGANIZATION_NOT_FOUND_MESSAGE);
    expect(store.invites.find((invite) => invite.tokenHash === liveHash)?.acceptedAt).toBeNull();
    expect(store.members.filter((member) => member.userId === invitee.id)).toHaveLength(0);
  });
});
