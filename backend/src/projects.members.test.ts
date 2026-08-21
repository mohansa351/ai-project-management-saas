import { describe, expect, it, jest } from '@jest/globals';
import type {
  Organization,
  OrganizationMember,
  PrismaClient,
  Project,
  ProjectMember,
  ProjectStatus,
  User,
} from '@prisma/client';
import request from 'supertest';
import { createApp } from './app.js';
import { AuthController } from './controllers/authController.js';
import { HealthController } from './controllers/healthController.js';
import { dummyOrganizationController } from './controllers/organizationController.js';
import { ProjectController } from './controllers/projectController.js';
import { AUTH_SESSION_UNAUTHORIZED_MESSAGE } from './lib/http/authErrors.js';
import { AUTHZ_FORBIDDEN_MESSAGE } from './lib/http/orgErrors.js';
import {
  DUPLICATE_PROJECT_MEMBER_ERROR,
  INVALID_PROJECT_MEMBER_USER_ERROR,
  PROJECT_MEMBER_NOT_FOUND_MESSAGE,
  PROJECT_NOT_FOUND_MESSAGE,
} from './lib/http/projectErrors.js';
import { signAccessToken } from './lib/jwt.js';
import { createRequireAccessToken } from './middleware/requireAccessToken.js';
import { createRequireOrganizationContext } from './middleware/requireOrganizationContext.js';
import { OrganizationMemberRepository } from './repositories/organizationMemberRepository.js';
import { OrganizationRepository } from './repositories/organizationRepository.js';
import { ProjectMemberRepository } from './repositories/projectMemberRepository.js';
import { ProjectRepository } from './repositories/projectRepository.js';
import type { UserRepository } from './repositories/userRepository.js';
import type { HealthService } from './services/healthService.js';
import { ProjectMemberService } from './services/projectMemberService.js';
import { ProjectService } from './services/projectService.js';

const now = new Date('2026-08-21T00:00:00.000Z');

type Store = {
  users: User[];
  orgs: Organization[];
  members: OrganizationMember[];
  projects: Project[];
  projectMembers: ProjectMember[];
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

function publicUser(user: User) {
  return { id: user.id, email: user.email, name: user.name };
}

function withUser(store: Store, row: ProjectMember) {
  const user = store.users.find((item) => item.id === row.userId);
  return {
    ...row,
    user: user
      ? publicUser(user)
      : { id: row.userId, email: `${row.userId}@example.com`, name: row.userId },
  };
}

function createFakePrisma(store: Store): PrismaClient {
  const client = {
    organization: {
      findFirst: jest.fn(async ({ where }: { where: { id: string; deletedAt?: null } }) => {
        const found = store.orgs.find(
          (org) => org.id === where.id && (where.deletedAt === undefined || org.deletedAt === where.deletedAt),
        );
        return found ? { ...found } : null;
      }),
    },
    organizationMember: {
      findFirst: jest.fn(
        async ({
          where,
        }: {
          where: { organizationId: string; userId: string; status?: 'ACTIVE' | 'PENDING' };
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
    project: {
      findFirst: jest.fn(async ({ where }: { where: { id: string; deletedAt?: null } }) => {
        const found = store.projects.find(
          (project) =>
            project.id === where.id && (where.deletedAt === undefined || project.deletedAt === where.deletedAt),
        );
        return found ? { ...found } : null;
      }),
    },
    projectMember: {
      upsert: jest.fn(
        async ({
          where,
          create,
        }: {
          where: { projectId_userId: { projectId: string; userId: string } };
          create: { projectId: string; userId: string };
        }) => {
          const existing = store.projectMembers.find(
            (row) =>
              row.projectId === where.projectId_userId.projectId &&
              row.userId === where.projectId_userId.userId,
          );
          if (existing) {
            return { ...existing };
          }
          const row: ProjectMember = {
            id: `pm_${++store.ids}`,
            projectId: create.projectId,
            userId: create.userId,
            createdAt: now,
            updatedAt: now,
          };
          store.projectMembers.push(row);
          return { ...row };
        },
      ),
      findUnique: jest.fn(
        async ({
          where,
        }: {
          where: { id?: string; projectId_userId?: { projectId: string; userId: string } };
        }) => {
          if (where.id) {
            const found = store.projectMembers.find((row) => row.id === where.id);
            return found ? withUser(store, found) : null;
          }
          if (where.projectId_userId) {
            const found = store.projectMembers.find(
              (row) =>
                row.projectId === where.projectId_userId?.projectId &&
                row.userId === where.projectId_userId.userId,
            );
            return found ? { ...found } : null;
          }
          return null;
        },
      ),
      findMany: jest.fn(
        async ({
          where,
          skip,
          take,
          orderBy,
        }: {
          where: { projectId: string };
          skip: number;
          take: number;
          orderBy?: Array<{ createdAt?: 'asc' | 'desc'; id?: 'asc' | 'desc' }>;
        }) => {
          const matched = store.projectMembers.filter((row) => row.projectId === where.projectId);
          const sorted = [...matched].sort((a, b) => {
            for (const rule of orderBy ?? []) {
              if (rule.createdAt) {
                const delta = a.createdAt.getTime() - b.createdAt.getTime();
                if (delta !== 0) {
                  return rule.createdAt === 'desc' ? -delta : delta;
                }
              }
              if (rule.id) {
                if (a.id === b.id) {
                  continue;
                }
                const idDelta = a.id < b.id ? -1 : 1;
                return rule.id === 'desc' ? -idDelta : idDelta;
              }
            }
            return 0;
          });
          return sorted.slice(skip, skip + take).map((row) => withUser(store, row));
        },
      ),
      count: jest.fn(async ({ where }: { where: { projectId: string } }) => {
        return store.projectMembers.filter((row) => row.projectId === where.projectId).length;
      }),
      create: jest.fn(async ({ data }: { data: { projectId: string; userId: string } }) => {
        const duplicate = store.projectMembers.find(
          (row) => row.projectId === data.projectId && row.userId === data.userId,
        );
        if (duplicate) {
          const err = Object.assign(new Error('Unique constraint'), { code: 'P2002' });
          throw err;
        }
        const row: ProjectMember = {
          id: `pm_${++store.ids}`,
          projectId: data.projectId,
          userId: data.userId,
          createdAt: now,
          updatedAt: now,
        };
        store.projectMembers.push(row);
        return withUser(store, row);
      }),
      delete: jest.fn(async ({ where }: { where: { id: string } }) => {
        const index = store.projectMembers.findIndex((row) => row.id === where.id);
        if (index === -1) {
          const err = Object.assign(new Error('Record not found'), { code: 'P2025' });
          throw err;
        }
        const [removed] = store.projectMembers.splice(index, 1);
        return removed;
      }),
    },
    $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn(client)),
  };
  return client as unknown as PrismaClient;
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

function seedOrgMember(
  store: Store,
  overrides: Pick<OrganizationMember, 'organizationId' | 'userId' | 'role' | 'status'> &
    Partial<OrganizationMember>,
): OrganizationMember {
  const member: OrganizationMember = {
    id: `om_${++store.ids}`,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
  store.members.push(member);
  return member;
}

function seedProject(
  store: Store,
  overrides: Partial<Project> & Pick<Project, 'id' | 'organizationId' | 'name' | 'ownerId'>,
): Project {
  const project: Project = {
    description: null,
    status: 'ACTIVE' as ProjectStatus,
    priority: 'MEDIUM',
    startDate: null,
    dueDate: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  };
  store.projects.push(project);
  return project;
}

function seedProjectMember(
  store: Store,
  overrides: Pick<ProjectMember, 'projectId' | 'userId'> & Partial<ProjectMember>,
): ProjectMember {
  const row: ProjectMember = {
    id: `pm_${++store.ids}`,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
  store.projectMembers.push(row);
  return row;
}

function membersApp(user: User | null, store: Store) {
  const prisma = createFakePrisma(store);
  const userRepository = {
    findById: jest.fn(async (id: string) => store.users.find((row) => row.id === id) ?? (user?.id === id ? user : null)),
  } as unknown as UserRepository;
  const organizationRepository = new OrganizationRepository(prisma);
  const organizationMemberRepository = new OrganizationMemberRepository(prisma);
  const projectRepository = new ProjectRepository(prisma);
  const projectMemberRepository = new ProjectMemberRepository(prisma);
  return {
    store,
    app: createApp({
      healthController: new HealthController({
        getReadiness: jest.fn(async () => ({ status: 'ok', postgres: 'up', redis: 'up', uptime: 1 })),
      } as unknown as HealthService),
      authController: stubAuthController(),
      organizationController: dummyOrganizationController(),
      projectController: new ProjectController(
        new ProjectService(
          projectRepository,
          projectMemberRepository,
          organizationRepository,
          organizationMemberRepository,
          prisma,
        ),
        new ProjectMemberService(
          projectRepository,
          projectMemberRepository,
          organizationRepository,
          organizationMemberRepository,
        ),
      ),
      requireAccessToken: createRequireAccessToken(userRepository),
      requireOrganizationContext: createRequireOrganizationContext({
        organizationRepository,
        organizationMemberRepository,
      }),
    }),
  };
}

async function bearer(userId: string, email = 'ada@example.com', systemRole: User['systemRole'] = 'USER') {
  return signAccessToken({ sub: userId, email, systemRole });
}

function emptyStore(): Store {
  return { users: [], orgs: [], members: [], projects: [], projectMembers: [], ids: 0 };
}

function seedLiveProject(store: Store) {
  seedOrg(store, { id: 'org_a', name: 'Acme' });
  seedProject(store, { id: 'proj_1', organizationId: 'org_a', name: 'Website', ownerId: 'owner_1' });
}

describe('project members', () => {
  it('returns 401 without a Bearer token', async () => {
    const store = emptyStore();
    seedLiveProject(store);
    const { app } = membersApp(null, store);

    const unauth = await request(app).get('/api/v1/projects/proj_1/members').expect(401);
    expect(unauth.body.error.message).toBe(AUTH_SESSION_UNAUTHORIZED_MESSAGE);
    await request(app).post('/api/v1/projects/proj_1/members').send({ userId: 'tm_1' }).expect(401);
    await request(app).delete('/api/v1/projects/proj_1/members/pm_x').expect(401);
  });

  it('returns 404 for missing or soft-deleted projects before exposing a roster', async () => {
    const store = emptyStore();
    const admin = storedUser();
    store.users.push(admin);
    seedLiveProject(store);
    seedOrgMember(store, { organizationId: 'org_a', userId: 'user_1', role: 'ORG_ADMIN', status: 'ACTIVE' });
    seedProject(store, {
      id: 'proj_del',
      organizationId: 'org_a',
      name: 'Gone',
      ownerId: 'user_1',
      deletedAt: now,
    });
    seedProjectMember(store, { id: 'hidden', projectId: 'proj_del', userId: 'user_1' });
    const { app } = membersApp(admin, store);
    const token = await bearer('user_1');

    const missing = await request(app)
      .get('/api/v1/projects/nope/members')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
    expect(missing.body.error.message).toBe(PROJECT_NOT_FOUND_MESSAGE);
    expect(missing.body.data).toBeUndefined();

    const deleted = await request(app)
      .get('/api/v1/projects/proj_del/members')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
    expect(deleted.body.error.message).toBe(PROJECT_NOT_FOUND_MESSAGE);

    await request(app)
      .post('/api/v1/projects/proj_del/members')
      .set('Authorization', `Bearer ${token}`)
      .send({ userId: 'user_1' })
      .expect(404);
    await request(app)
      .delete('/api/v1/projects/proj_del/members/hidden')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
    expect(store.projectMembers.some((row) => row.id === 'hidden')).toBe(true);
  });

  it('lets AD-4 callers list members of an archived live project', async () => {
    const store = emptyStore();
    const admin = storedUser();
    store.users.push(admin);
    seedLiveProject(store);
    store.projects[0]!.status = 'ARCHIVED';
    seedOrgMember(store, { organizationId: 'org_a', userId: 'user_1', role: 'ORG_ADMIN', status: 'ACTIVE' });
    seedProjectMember(store, { id: 'pm_owner', projectId: 'proj_1', userId: 'user_1' });
    const { app } = membersApp(admin, store);
    const token = await bearer('user_1');

    const res = await request(app)
      .get('/api/v1/projects/proj_1/members')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.data.members).toHaveLength(1);
  });

  it('lets ORG_ADMIN list without a ProjectMember seat and omits sensitive user fields', async () => {
    const store = emptyStore();
    const admin = storedUser();
    const tm = storedUser({ id: 'tm_1', email: 'tm@example.com', name: 'Team', passwordHash: 'hash', sessionEpoch: 9 });
    store.users.push(admin, tm);
    seedLiveProject(store);
    seedOrgMember(store, { organizationId: 'org_a', userId: 'user_1', role: 'ORG_ADMIN', status: 'ACTIVE' });
    seedOrgMember(store, { organizationId: 'org_a', userId: 'tm_1', role: 'TEAM_MEMBER', status: 'ACTIVE' });
    seedProjectMember(store, { id: 'pm_tm', projectId: 'proj_1', userId: 'tm_1' });
    const { app } = membersApp(admin, store);
    const token = await bearer('user_1');

    const res = await request(app)
      .get('/api/v1/projects/proj_1/members')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.meta).toMatchObject({ page: 1, pageSize: 20, total: 1, totalPages: 1 });
    expect(res.body.data.members[0]).toMatchObject({
      id: 'pm_tm',
      projectId: 'proj_1',
      userId: 'tm_1',
      user: { id: 'tm_1', email: 'tm@example.com', name: 'Team' },
    });
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
    expect(JSON.stringify(res.body)).not.toContain('sessionEpoch');
    expect(JSON.stringify(res.body)).not.toContain('secret-hash');
    expect(JSON.stringify(res.body)).not.toContain('tokenHash');
  });

  it('paginates project members', async () => {
    const store = emptyStore();
    const admin = storedUser();
    store.users.push(
      admin,
      storedUser({ id: 'a', email: 'a@example.com', name: 'A' }),
      storedUser({ id: 'b', email: 'b@example.com', name: 'B' }),
      storedUser({ id: 'c', email: 'c@example.com', name: 'C' }),
    );
    seedLiveProject(store);
    seedOrgMember(store, { organizationId: 'org_a', userId: 'user_1', role: 'ORG_ADMIN', status: 'ACTIVE' });
    seedProjectMember(store, { id: 'pm_a', projectId: 'proj_1', userId: 'a', createdAt: new Date('2026-08-21T00:00:01.000Z') });
    seedProjectMember(store, { id: 'pm_b', projectId: 'proj_1', userId: 'b', createdAt: new Date('2026-08-21T00:00:02.000Z') });
    seedProjectMember(store, { id: 'pm_c', projectId: 'proj_1', userId: 'c', createdAt: new Date('2026-08-21T00:00:03.000Z') });
    const { app } = membersApp(admin, store);
    const token = await bearer('user_1');

    const res = await request(app)
      .get('/api/v1/projects/proj_1/members')
      .query({ page: 1, pageSize: 2 })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.data.members.map((row: { id: string }) => row.id)).toEqual(['pm_c', 'pm_b']);
    expect(res.body.meta).toMatchObject({ page: 1, pageSize: 2, total: 3, totalPages: 2 });

    const page2 = await request(app)
      .get('/api/v1/projects/proj_1/members')
      .query({ page: 2, pageSize: 2 })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(page2.body.data.members.map((row: { id: string }) => row.id)).toEqual(['pm_a']);
  });

  it('lets PROJECT_MANAGER and TEAM_MEMBER with a seat list members', async () => {
    const store = emptyStore();
    const pm = storedUser({ id: 'pm_1', email: 'pm@example.com' });
    const tm = storedUser({ id: 'tm_1', email: 'tm@example.com', name: 'Team' });
    store.users.push(pm, tm);
    seedLiveProject(store);
    seedOrgMember(store, { organizationId: 'org_a', userId: 'pm_1', role: 'PROJECT_MANAGER', status: 'ACTIVE' });
    seedOrgMember(store, { organizationId: 'org_a', userId: 'tm_1', role: 'TEAM_MEMBER', status: 'ACTIVE' });
    seedProjectMember(store, { projectId: 'proj_1', userId: 'pm_1' });
    seedProjectMember(store, { projectId: 'proj_1', userId: 'tm_1' });
    const { app } = membersApp(pm, store);

    const pmRes = await request(app)
      .get('/api/v1/projects/proj_1/members')
      .set('Authorization', `Bearer ${await bearer('pm_1', 'pm@example.com')}`)
      .expect(200);
    expect(pmRes.body.data.members).toHaveLength(2);

    const tmRes = await request(app)
      .get('/api/v1/projects/proj_1/members')
      .set('Authorization', `Bearer ${await bearer('tm_1', 'tm@example.com')}`)
      .expect(200);
    expect(tmRes.body.data.members).toHaveLength(2);
  });

  it('returns 403 for PROJECT_MANAGER or TEAM_MEMBER without a seat, and for foreign org members', async () => {
    const store = emptyStore();
    const pm = storedUser({ id: 'pm_1', email: 'pm@example.com' });
    const tm = storedUser({ id: 'tm_1', email: 'tm@example.com' });
    const other = storedUser({ id: 'other_1', email: 'other@example.com' });
    store.users.push(pm, tm, other);
    seedLiveProject(store);
    seedOrg(store, { id: 'org_b', name: 'Beta' });
    seedOrgMember(store, { organizationId: 'org_a', userId: 'pm_1', role: 'PROJECT_MANAGER', status: 'ACTIVE' });
    seedOrgMember(store, { organizationId: 'org_a', userId: 'tm_1', role: 'TEAM_MEMBER', status: 'ACTIVE' });
    seedOrgMember(store, { organizationId: 'org_b', userId: 'other_1', role: 'ORG_ADMIN', status: 'ACTIVE' });
    const { app } = membersApp(pm, store);

    const pmRes = await request(app)
      .get('/api/v1/projects/proj_1/members')
      .set('Authorization', `Bearer ${await bearer('pm_1', 'pm@example.com')}`)
      .expect(403);
    expect(pmRes.body.error.message).toBe(AUTHZ_FORBIDDEN_MESSAGE);

    await request(app)
      .get('/api/v1/projects/proj_1/members')
      .set('Authorization', `Bearer ${await bearer('tm_1', 'tm@example.com')}`)
      .expect(403);
    await request(app)
      .get('/api/v1/projects/proj_1/members')
      .set('Authorization', `Bearer ${await bearer('other_1', 'other@example.com')}`)
      .set('X-Organization-Id', 'org_b')
      .expect(403);
  });

  it('does not grant access via a spoofed X-Organization-Id', async () => {
    const store = emptyStore();
    const adminA = storedUser();
    store.users.push(adminA);
    seedLiveProject(store);
    seedOrg(store, { id: 'org_b', name: 'Beta' });
    seedOrgMember(store, { organizationId: 'org_a', userId: 'user_1', role: 'ORG_ADMIN', status: 'ACTIVE' });
    seedProject(store, { id: 'proj_b', organizationId: 'org_b', name: 'Secret', ownerId: 'other' });
    seedProjectMember(store, { id: 'secret_pm', projectId: 'proj_b', userId: 'other' });
    const { app } = membersApp(adminA, store);
    const token = await bearer('user_1');

    const res = await request(app)
      .get('/api/v1/projects/proj_b/members')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Organization-Id', 'org_a')
      .expect(403);
    expect(res.body.error.code).toBe('AUTHZ_FORBIDDEN');
    expect(res.body.data).toBeUndefined();
  });

  it('does not let SUPER_ADMIN bypass missing organization/project membership', async () => {
    const store = emptyStore();
    const sa = storedUser({ id: 'sa_1', email: 'sa@example.com', systemRole: 'SUPER_ADMIN' });
    store.users.push(sa);
    seedLiveProject(store);
    seedProjectMember(store, { id: 'pm_hidden', projectId: 'proj_1', userId: 'owner_1' });
    const { app } = membersApp(sa, store);
    const token = await bearer('sa_1', 'sa@example.com', 'SUPER_ADMIN');

    const listRes = await request(app)
      .get('/api/v1/projects/proj_1/members')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Organization-Id', 'org_a')
      .expect(403);
    expect(listRes.body.error.code).toBe('AUTHZ_FORBIDDEN');

    await request(app)
      .post('/api/v1/projects/proj_1/members')
      .set('Authorization', `Bearer ${token}`)
      .send({ userId: 'sa_1' })
      .expect(403);
    await request(app)
      .delete('/api/v1/projects/proj_1/members/pm_hidden')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
    expect(store.projectMembers).toHaveLength(1);
  });

  it('adds an ACTIVE same-org user and lets them GET the project', async () => {
    const store = emptyStore();
    const pm = storedUser({ id: 'pm_1', email: 'pm@example.com' });
    const tm = storedUser({ id: 'tm_1', email: 'tm@example.com', name: 'Team' });
    store.users.push(pm, tm);
    seedLiveProject(store);
    seedOrgMember(store, { organizationId: 'org_a', userId: 'pm_1', role: 'PROJECT_MANAGER', status: 'ACTIVE' });
    seedOrgMember(store, { organizationId: 'org_a', userId: 'tm_1', role: 'TEAM_MEMBER', status: 'ACTIVE' });
    seedProjectMember(store, { projectId: 'proj_1', userId: 'pm_1' });
    const { app } = membersApp(pm, store);
    const token = await bearer('pm_1', 'pm@example.com');

    const res = await request(app)
      .post('/api/v1/projects/proj_1/members')
      .set('Authorization', `Bearer ${token}`)
      .send({ userId: 'tm_1' })
      .expect(201);
    expect(res.body.data.member).toMatchObject({
      projectId: 'proj_1',
      userId: 'tm_1',
      user: { id: 'tm_1', email: 'tm@example.com', name: 'Team' },
    });
    expect(store.projectMembers.some((row) => row.userId === 'tm_1' && row.projectId === 'proj_1')).toBe(true);

    const listRes = await request(app)
      .get('/api/v1/projects/proj_1/members')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(listRes.body.data.members.some((row: { userId: string }) => row.userId === 'tm_1')).toBe(true);

    await request(app)
      .get('/api/v1/projects/proj_1')
      .set('Authorization', `Bearer ${await bearer('tm_1', 'tm@example.com')}`)
      .expect(200);
  });

  it('lets ORG_ADMIN add without a seat, including adding themselves', async () => {
    const store = emptyStore();
    const admin = storedUser();
    const tm = storedUser({ id: 'tm_1', email: 'tm@example.com', name: 'Team' });
    store.users.push(admin, tm);
    seedLiveProject(store);
    seedOrgMember(store, { organizationId: 'org_a', userId: 'user_1', role: 'ORG_ADMIN', status: 'ACTIVE' });
    seedOrgMember(store, { organizationId: 'org_a', userId: 'tm_1', role: 'TEAM_MEMBER', status: 'ACTIVE' });
    const { app } = membersApp(admin, store);
    const token = await bearer('user_1');

    await request(app)
      .post('/api/v1/projects/proj_1/members')
      .set('Authorization', `Bearer ${token}`)
      .send({ userId: 'tm_1' })
      .expect(201);
    const self = await request(app)
      .post('/api/v1/projects/proj_1/members')
      .set('Authorization', `Bearer ${token}`)
      .send({ userId: 'user_1' })
      .expect(201);
    expect(self.body.data.member.userId).toBe('user_1');
    expect(store.projects[0]?.ownerId).toBe('owner_1');
  });

  it('rejects TEAM_MEMBER writes and PROJECT_MANAGER writes without a seat', async () => {
    const store = emptyStore();
    const tm = storedUser({ id: 'tm_1', email: 'tm@example.com' });
    const pm = storedUser({ id: 'pm_1', email: 'pm@example.com' });
    const other = storedUser({ id: 'tm_2', email: 'tm2@example.com' });
    store.users.push(tm, pm, other);
    seedLiveProject(store);
    seedOrgMember(store, { organizationId: 'org_a', userId: 'tm_1', role: 'TEAM_MEMBER', status: 'ACTIVE' });
    seedOrgMember(store, { organizationId: 'org_a', userId: 'pm_1', role: 'PROJECT_MANAGER', status: 'ACTIVE' });
    seedOrgMember(store, { organizationId: 'org_a', userId: 'tm_2', role: 'TEAM_MEMBER', status: 'ACTIVE' });
    const seated = seedProjectMember(store, { id: 'pm_tm', projectId: 'proj_1', userId: 'tm_1' });
    const { app } = membersApp(tm, store);

    await request(app)
      .post('/api/v1/projects/proj_1/members')
      .set('Authorization', `Bearer ${await bearer('tm_1', 'tm@example.com')}`)
      .send({ userId: 'tm_2' })
      .expect(403);
    await request(app)
      .delete(`/api/v1/projects/proj_1/members/${seated.id}`)
      .set('Authorization', `Bearer ${await bearer('tm_1', 'tm@example.com')}`)
      .expect(403);
    expect(store.projectMembers).toHaveLength(1);

    await request(app)
      .post('/api/v1/projects/proj_1/members')
      .set('Authorization', `Bearer ${await bearer('pm_1', 'pm@example.com')}`)
      .send({ userId: 'tm_2' })
      .expect(403);
    await request(app)
      .delete('/api/v1/projects/proj_1/members/pm_tm')
      .set('Authorization', `Bearer ${await bearer('pm_1', 'pm@example.com')}`)
      .expect(403);
    expect(store.projectMembers).toHaveLength(1);
  });

  it('rejects invalid add targets with 400', async () => {
    const store = emptyStore();
    const admin = storedUser();
    const pending = storedUser({ id: 'pending_1', email: 'pending@example.com' });
    const foreign = storedUser({ id: 'foreign_1', email: 'foreign@example.com' });
    store.users.push(admin, pending, foreign);
    seedLiveProject(store);
    seedOrg(store, { id: 'org_b', name: 'Beta' });
    seedOrgMember(store, { organizationId: 'org_a', userId: 'user_1', role: 'ORG_ADMIN', status: 'ACTIVE' });
    seedOrgMember(store, { organizationId: 'org_a', userId: 'pending_1', role: 'TEAM_MEMBER', status: 'PENDING' });
    seedOrgMember(store, { organizationId: 'org_b', userId: 'foreign_1', role: 'TEAM_MEMBER', status: 'ACTIVE' });
    seedProjectMember(store, { projectId: 'proj_1', userId: 'user_1' });
    const { app } = membersApp(admin, store);
    const token = await bearer('user_1');

    const empty = await request(app)
      .post('/api/v1/projects/proj_1/members')
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(400);
    expect(empty.body.error.code).toBe('VALIDATION_ERROR');
    expect(store.projectMembers).toHaveLength(1);

    const blank = await request(app)
      .post('/api/v1/projects/proj_1/members')
      .set('Authorization', `Bearer ${token}`)
      .send({ userId: '   ' })
      .expect(400);
    expect(blank.body.error.code).toBe('VALIDATION_ERROR');
    expect(store.projectMembers).toHaveLength(1);

    const pendingRes = await request(app)
      .post('/api/v1/projects/proj_1/members')
      .set('Authorization', `Bearer ${token}`)
      .send({ userId: 'pending_1' })
      .expect(400);
    expect(pendingRes.body.error.details).toEqual(INVALID_PROJECT_MEMBER_USER_ERROR.details);
    expect(store.projectMembers).toHaveLength(1);

    const foreignRes = await request(app)
      .post('/api/v1/projects/proj_1/members')
      .set('Authorization', `Bearer ${token}`)
      .send({ userId: 'foreign_1' })
      .expect(400);
    expect(foreignRes.body.error.code).toBe('VALIDATION_ERROR');

    const missing = await request(app)
      .post('/api/v1/projects/proj_1/members')
      .set('Authorization', `Bearer ${token}`)
      .send({ userId: 'ghost' })
      .expect(400);
    expect(missing.body.error.code).toBe('VALIDATION_ERROR');

    const duplicate = await request(app)
      .post('/api/v1/projects/proj_1/members')
      .set('Authorization', `Bearer ${token}`)
      .send({ userId: 'user_1' })
      .expect(400);
    expect(duplicate.body.error.message).toBe(DUPLICATE_PROJECT_MEMBER_ERROR.message);
    expect(store.projectMembers.filter((row) => row.userId === 'user_1')).toHaveLength(1);
  });

  it('hard-deletes a member, allows removing the owner seat, and 404s unknown member ids', async () => {
    const store = emptyStore();
    const pm = storedUser({ id: 'pm_1', email: 'pm@example.com' });
    const tm = storedUser({ id: 'tm_1', email: 'tm@example.com' });
    store.users.push(pm, tm);
    seedLiveProject(store);
    store.projects[0]!.ownerId = 'pm_1';
    seedOrgMember(store, { organizationId: 'org_a', userId: 'pm_1', role: 'PROJECT_MANAGER', status: 'ACTIVE' });
    seedOrgMember(store, { organizationId: 'org_a', userId: 'tm_1', role: 'TEAM_MEMBER', status: 'ACTIVE' });
    const ownerSeat = seedProjectMember(store, { id: 'pm_owner', projectId: 'proj_1', userId: 'pm_1' });
    const tmSeat = seedProjectMember(store, { id: 'pm_tm', projectId: 'proj_1', userId: 'tm_1' });
    seedProject(store, { id: 'proj_2', organizationId: 'org_a', name: 'Other', ownerId: 'pm_1' });
    seedProjectMember(store, { id: 'pm_other', projectId: 'proj_2', userId: 'pm_1' });
    const { app } = membersApp(pm, store);
    const token = await bearer('pm_1', 'pm@example.com');

    const wrong = await request(app)
      .delete('/api/v1/projects/proj_1/members/pm_other')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
    expect(wrong.body.error.message).toBe(PROJECT_MEMBER_NOT_FOUND_MESSAGE);
    expect(store.projectMembers.some((row) => row.id === 'pm_other')).toBe(true);

    await request(app)
      .delete('/api/v1/projects/proj_1/members/missing')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);

    const removed = await request(app)
      .delete(`/api/v1/projects/proj_1/members/${tmSeat.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(removed.body.data.member.id).toBe('pm_tm');
    expect(store.projectMembers.some((row) => row.id === 'pm_tm')).toBe(false);

    await request(app)
      .get('/api/v1/projects/proj_1')
      .set('Authorization', `Bearer ${await bearer('tm_1', 'tm@example.com')}`)
      .expect(403);

    const ownerRes = await request(app)
      .delete(`/api/v1/projects/proj_1/members/${ownerSeat.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(ownerRes.body.data.member.userId).toBe('pm_1');
    expect(store.projects[0]?.ownerId).toBe('pm_1');
    expect(store.projectMembers.some((row) => row.projectId === 'proj_1')).toBe(false);
  });

  it('allows removing the last ProjectMember and still lets ORG_ADMIN access the project', async () => {
    const store = emptyStore();
    const admin = storedUser();
    const pm = storedUser({ id: 'pm_1', email: 'pm@example.com' });
    store.users.push(admin, pm);
    seedLiveProject(store);
    seedOrgMember(store, { organizationId: 'org_a', userId: 'user_1', role: 'ORG_ADMIN', status: 'ACTIVE' });
    seedOrgMember(store, { organizationId: 'org_a', userId: 'pm_1', role: 'PROJECT_MANAGER', status: 'ACTIVE' });
    const only = seedProjectMember(store, { id: 'pm_only', projectId: 'proj_1', userId: 'pm_1' });
    const { app } = membersApp(admin, store);
    const token = await bearer('user_1');

    await request(app)
      .delete(`/api/v1/projects/proj_1/members/${only.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(store.projectMembers).toHaveLength(0);

    await request(app).get('/api/v1/projects/proj_1').set('Authorization', `Bearer ${token}`).expect(200);
    await request(app)
      .get('/api/v1/projects/proj_1')
      .set('Authorization', `Bearer ${await bearer('pm_1', 'pm@example.com')}`)
      .expect(403);
  });

  it('lets a PROJECT_MANAGER remove themselves and then 403s on project detail', async () => {
    const store = emptyStore();
    const pm = storedUser({ id: 'pm_1', email: 'pm@example.com' });
    store.users.push(pm);
    seedLiveProject(store);
    seedOrgMember(store, { organizationId: 'org_a', userId: 'pm_1', role: 'PROJECT_MANAGER', status: 'ACTIVE' });
    const seat = seedProjectMember(store, { id: 'pm_self', projectId: 'proj_1', userId: 'pm_1' });
    const { app } = membersApp(pm, store);
    const token = await bearer('pm_1', 'pm@example.com');

    await request(app)
      .delete(`/api/v1/projects/proj_1/members/${seat.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    await request(app).get('/api/v1/projects/proj_1').set('Authorization', `Bearer ${token}`).expect(403);
  });

  it('does not require X-Organization-Id on member routes', async () => {
    const store = emptyStore();
    const admin = storedUser();
    store.users.push(admin);
    seedLiveProject(store);
    seedOrgMember(store, { organizationId: 'org_a', userId: 'user_1', role: 'ORG_ADMIN', status: 'ACTIVE' });
    const { app } = membersApp(admin, store);
    const token = await bearer('user_1');

    await request(app).get('/api/v1/projects/proj_1/members').set('Authorization', `Bearer ${token}`).expect(200);
  });

  it('lets ORG_ADMIN add and remove members on an archived live project', async () => {
    const store = emptyStore();
    const admin = storedUser();
    const tm = storedUser({ id: 'tm_1', email: 'tm@example.com', name: 'Team' });
    store.users.push(admin, tm);
    seedLiveProject(store);
    store.projects[0]!.status = 'ARCHIVED';
    seedOrgMember(store, { organizationId: 'org_a', userId: 'user_1', role: 'ORG_ADMIN', status: 'ACTIVE' });
    seedOrgMember(store, { organizationId: 'org_a', userId: 'tm_1', role: 'TEAM_MEMBER', status: 'ACTIVE' });
    const { app } = membersApp(admin, store);
    const token = await bearer('user_1');

    const added = await request(app)
      .post('/api/v1/projects/proj_1/members')
      .set('Authorization', `Bearer ${token}`)
      .send({ userId: 'tm_1' })
      .expect(201);
    await request(app)
      .delete(`/api/v1/projects/proj_1/members/${added.body.data.member.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(store.projectMembers).toHaveLength(0);
  });

  it('does not leak another project roster and rejects PENDING callers', async () => {
    const store = emptyStore();
    const admin = storedUser();
    const pending = storedUser({ id: 'pending_1', email: 'pending@example.com' });
    const other = storedUser({ id: 'other_1', email: 'other@example.com' });
    store.users.push(admin, pending, other);
    seedLiveProject(store);
    seedOrgMember(store, { organizationId: 'org_a', userId: 'user_1', role: 'ORG_ADMIN', status: 'ACTIVE' });
    seedOrgMember(store, { organizationId: 'org_a', userId: 'pending_1', role: 'TEAM_MEMBER', status: 'PENDING' });
    seedProject(store, { id: 'proj_2', organizationId: 'org_a', name: 'Other', ownerId: 'user_1' });
    seedProjectMember(store, { id: 'pm_here', projectId: 'proj_1', userId: 'user_1' });
    seedProjectMember(store, { id: 'pm_there', projectId: 'proj_2', userId: 'other_1' });
    const { app } = membersApp(admin, store);
    const token = await bearer('user_1');

    const res = await request(app)
      .get('/api/v1/projects/proj_1/members')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.data.members.map((row: { id: string }) => row.id)).toEqual(['pm_here']);

    await request(app)
      .get('/api/v1/projects/proj_1/members')
      .set('Authorization', `Bearer ${await bearer('pending_1', 'pending@example.com')}`)
      .expect(403);
  });

  it('ignores a spoofed header on member writes', async () => {
    const store = emptyStore();
    const adminA = storedUser();
    const tm = storedUser({ id: 'tm_1', email: 'tm@example.com' });
    store.users.push(adminA, tm);
    seedLiveProject(store);
    seedOrg(store, { id: 'org_b', name: 'Beta' });
    seedOrgMember(store, { organizationId: 'org_a', userId: 'user_1', role: 'ORG_ADMIN', status: 'ACTIVE' });
    seedOrgMember(store, { organizationId: 'org_b', userId: 'tm_1', role: 'TEAM_MEMBER', status: 'ACTIVE' });
    seedProject(store, { id: 'proj_b', organizationId: 'org_b', name: 'Secret', ownerId: 'other' });
    seedProjectMember(store, { id: 'secret_pm', projectId: 'proj_b', userId: 'tm_1' });
    const { app } = membersApp(adminA, store);
    const token = await bearer('user_1');

    await request(app)
      .post('/api/v1/projects/proj_b/members')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Organization-Id', 'org_a')
      .send({ userId: 'user_1' })
      .expect(403);
    await request(app)
      .delete('/api/v1/projects/proj_b/members/secret_pm')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Organization-Id', 'org_a')
      .expect(403);
    expect(store.projectMembers).toHaveLength(1);
  });

  it('lets ORG_ADMIN remove their own seat and still GET the project', async () => {
    const store = emptyStore();
    const admin = storedUser();
    store.users.push(admin);
    seedLiveProject(store);
    seedOrgMember(store, { organizationId: 'org_a', userId: 'user_1', role: 'ORG_ADMIN', status: 'ACTIVE' });
    const seat = seedProjectMember(store, { id: 'pm_admin', projectId: 'proj_1', userId: 'user_1' });
    const { app } = membersApp(admin, store);
    const token = await bearer('user_1');

    await request(app)
      .delete(`/api/v1/projects/proj_1/members/${seat.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    await request(app).get('/api/v1/projects/proj_1').set('Authorization', `Bearer ${token}`).expect(200);
  });
});
