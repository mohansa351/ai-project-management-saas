import { describe, expect, it, jest } from '@jest/globals';
import type {
  Organization,
  OrganizationMember,
  PrismaClient,
  Project,
  ProjectMember,
  ProjectPriority,
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
import { AUTHZ_FORBIDDEN_MESSAGE, ORGANIZATION_NOT_FOUND_MESSAGE, ORG_CONTEXT_REQUIRED_MESSAGE } from './lib/http/orgErrors.js';
import { PROJECT_NOT_FOUND_MESSAGE } from './lib/http/projectErrors.js';
import { signAccessToken } from './lib/jwt.js';
import { createRequireAccessToken } from './middleware/requireAccessToken.js';
import { createRequireOrganizationContext } from './middleware/requireOrganizationContext.js';
import { OrganizationMemberRepository } from './repositories/organizationMemberRepository.js';
import { OrganizationRepository } from './repositories/organizationRepository.js';
import { ProjectMemberRepository } from './repositories/projectMemberRepository.js';
import { ProjectRepository } from './repositories/projectRepository.js';
import { projectSoftDeleteCascade } from './repositories/projectSoftDeleteCascade.js';
import type { UserRepository } from './repositories/userRepository.js';
import type { HealthService } from './services/healthService.js';
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

function matchesProjectListWhere(
  store: Store,
  project: Project,
  where: {
    organizationId: string;
    deletedAt: null;
    status?: ProjectStatus | { not: ProjectStatus };
    members?: { some: { userId: string } };
  },
): boolean {
  if (project.organizationId !== where.organizationId) {
    return false;
  }
  if (where.deletedAt === null && project.deletedAt !== null) {
    return false;
  }
  if (typeof where.status === 'string' && project.status !== where.status) {
    return false;
  }
  if (where.status && typeof where.status === 'object' && project.status === where.status.not) {
    return false;
  }
  if (where.members?.some.userId) {
    const member = store.projectMembers.some(
      (row) => row.projectId === project.id && row.userId === where.members?.some.userId,
    );
    if (!member) {
      return false;
    }
  }
  return true;
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
      create: jest.fn(
        async ({
          data,
        }: {
          data: {
            organizationId: string;
            name: string;
            description: string | null;
            status: ProjectStatus;
            priority: ProjectPriority;
            startDate: Date | null;
            dueDate: Date | null;
            ownerId: string;
          };
        }) => {
          const project: Project = {
            id: `proj_${++store.ids}`,
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
            ...data,
          };
          store.projects.push(project);
          return { ...project };
        },
      ),
      findFirst: jest.fn(async ({ where }: { where: { id: string; deletedAt?: null } }) => {
        const found = store.projects.find(
          (project) =>
            project.id === where.id && (where.deletedAt === undefined || project.deletedAt === where.deletedAt),
        );
        return found ? { ...found } : null;
      }),
      findMany: jest.fn(
        async ({
          where,
          skip,
          take,
        }: {
          where: {
            organizationId: string;
            deletedAt: null;
            status?: ProjectStatus | { not: ProjectStatus };
            members?: { some: { userId: string } };
          };
          skip: number;
          take: number;
        }) => {
          const matched = store.projects
            .filter((project) => matchesProjectListWhere(store, project, where))
            .sort((a, b) => (a.id < b.id ? 1 : -1));
          return matched.slice(skip, skip + take).map((project) => ({ ...project }));
        },
      ),
      count: jest.fn(
        async ({
          where,
        }: {
          where: {
            organizationId: string;
            deletedAt: null;
            status?: ProjectStatus | { not: ProjectStatus };
            members?: { some: { userId: string } };
          };
        }) => store.projects.filter((project) => matchesProjectListWhere(store, project, where)).length,
      ),
      updateMany: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string; deletedAt: null };
          data: Partial<Project>;
        }) => {
          const index = store.projects.findIndex(
            (project) => project.id === where.id && project.deletedAt === where.deletedAt,
          );
          const current = store.projects[index];
          if (index === -1 || !current) {
            return { count: 0 };
          }
          store.projects[index] = { ...current, ...data, updatedAt: now };
          return { count: 1 };
        },
      ),
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
          where: { projectId_userId: { projectId: string; userId: string } };
        }) => {
          const found = store.projectMembers.find(
            (row) =>
              row.projectId === where.projectId_userId.projectId &&
              row.userId === where.projectId_userId.userId,
          );
          return found ? { ...found } : null;
        },
      ),
    },
    $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => {
      const projectSnap = store.projects.map((project) => ({ ...project }));
      const memberSnap = store.projectMembers.map((row) => ({ ...row }));
      try {
        return await fn(client);
      } catch (err) {
        store.projects.splice(0, store.projects.length, ...projectSnap);
        store.projectMembers.splice(0, store.projectMembers.length, ...memberSnap);
        throw err;
      }
    }),
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
    status: 'ACTIVE',
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

function projectApp(user: User | null, store: Store) {
  const prisma = createFakePrisma(store);
  const userRepository = {
    findById: jest.fn(async (id: string) => store.users.find((row) => row.id === id) ?? (user?.id === id ? user : null)),
  } as unknown as UserRepository;
  const organizationRepository = new OrganizationRepository(prisma);
  const organizationMemberRepository = new OrganizationMemberRepository(prisma);
  return {
    store,
    prisma,
    app: createApp({
      healthController: new HealthController({
        getReadiness: jest.fn(async () => ({ status: 'ok', postgres: 'up', redis: 'up', uptime: 1 })),
      } as unknown as HealthService),
      authController: stubAuthController(),
      organizationController: dummyOrganizationController(),
      projectController: new ProjectController(
        new ProjectService(
          new ProjectRepository(prisma),
          new ProjectMemberRepository(prisma),
          organizationRepository,
          organizationMemberRepository,
          prisma,
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

describe('project CRUD', () => {
  it('creates a project for PROJECT_MANAGER and upserts ProjectMember with ownerId metadata', async () => {
    const store = emptyStore();
    const user = storedUser({ id: 'pm_user' });
    store.users.push(user);
    seedOrg(store, { id: 'org_a', name: 'Acme' });
    seedOrgMember(store, {
      organizationId: 'org_a',
      userId: 'pm_user',
      role: 'PROJECT_MANAGER',
      status: 'ACTIVE',
    });
    const { app } = projectApp(user, store);
    const token = await bearer('pm_user');

    const res = await request(app)
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Organization-Id', 'org_a')
      .send({ name: '  Website  ' })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.project).toMatchObject({
      name: 'Website',
      organizationId: 'org_a',
      ownerId: 'pm_user',
      status: 'PLANNING',
      priority: 'MEDIUM',
      deletedAt: null,
    });
    expect(store.projectMembers.some((row) => row.userId === 'pm_user' && row.projectId === res.body.data.project.id)).toBe(
      true,
    );
  });

  it('creates a project for ORG_ADMIN and upserts ProjectMember', async () => {
    const store = emptyStore();
    const user = storedUser({ id: 'admin_1' });
    store.users.push(user);
    seedOrg(store, { id: 'org_a', name: 'Acme' });
    seedOrgMember(store, { organizationId: 'org_a', userId: 'admin_1', role: 'ORG_ADMIN', status: 'ACTIVE' });
    const { app } = projectApp(user, store);
    const token = await bearer('admin_1');

    const res = await request(app)
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Organization-Id', 'org_a')
      .send({ name: 'Admin Project' })
      .expect(201);

    expect(res.body.data.project.ownerId).toBe('admin_1');
    expect(store.projectMembers).toHaveLength(1);
  });

  it('rejects TEAM_MEMBER create with 403', async () => {
    const store = emptyStore();
    const user = storedUser({ id: 'tm_1' });
    store.users.push(user);
    seedOrg(store, { id: 'org_a', name: 'Acme' });
    seedOrgMember(store, { organizationId: 'org_a', userId: 'tm_1', role: 'TEAM_MEMBER', status: 'ACTIVE' });
    const { app } = projectApp(user, store);
    const token = await bearer('tm_1');

    const res = await request(app)
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Organization-Id', 'org_a')
      .send({ name: 'Nope' })
      .expect(403);

    expect(res.body.error.code).toBe('AUTHZ_FORBIDDEN');
    expect(store.projects).toHaveLength(0);
  });

  it('requires X-Organization-Id on create and list', async () => {
    const store = emptyStore();
    const user = storedUser();
    store.users.push(user);
    seedOrg(store, { id: 'org_a', name: 'Acme' });
    seedOrgMember(store, { organizationId: 'org_a', userId: 'user_1', role: 'ORG_ADMIN', status: 'ACTIVE' });
    const { app } = projectApp(user, store);
    const token = await bearer('user_1');

    const createRes = await request(app)
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Website' })
      .expect(400);
    expect(createRes.body.error.code).toBe('VALIDATION_ERROR');
    expect(createRes.body.error.details['x-organization-id']).toContain(ORG_CONTEXT_REQUIRED_MESSAGE);

    const listRes = await request(app).get('/api/v1/projects').set('Authorization', `Bearer ${token}`).expect(400);
    expect(listRes.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a spoofed organization header without ACTIVE membership', async () => {
    const store = emptyStore();
    const user = storedUser();
    store.users.push(user);
    seedOrg(store, { id: 'org_b', name: 'Other' });
    const { app } = projectApp(user, store);
    const token = await bearer('user_1');

    const res = await request(app)
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Organization-Id', 'org_b')
      .send({ name: 'Leak' })
      .expect(403);
    expect(res.body.error.code).toBe('AUTHZ_FORBIDDEN');
    expect(res.body.error.message).toBe(AUTHZ_FORBIDDEN_MESSAGE);
  });

  it('rejects create when body organizationId does not match the header', async () => {
    const store = emptyStore();
    const user = storedUser();
    store.users.push(user);
    seedOrg(store, { id: 'org_a', name: 'Acme' });
    seedOrg(store, { id: 'org_b', name: 'Beta' });
    seedOrgMember(store, { organizationId: 'org_a', userId: 'user_1', role: 'ORG_ADMIN', status: 'ACTIVE' });
    const { app } = projectApp(user, store);
    const token = await bearer('user_1');

    const res = await request(app)
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Organization-Id', 'org_a')
      .send({ name: 'Website', organizationId: 'org_b' })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(store.projects).toHaveLength(0);
  });

  it('does not let SUPER_ADMIN bypass missing membership', async () => {
    const store = emptyStore();
    const user = storedUser({ id: 'sa_1', systemRole: 'SUPER_ADMIN', email: 'sa@example.com' });
    store.users.push(user);
    seedOrg(store, { id: 'org_a', name: 'Acme' });
    seedProject(store, { id: 'proj_live', organizationId: 'org_a', name: 'Live', ownerId: 'other' });
    const { app } = projectApp(user, store);
    const token = await bearer('sa_1', 'sa@example.com', 'SUPER_ADMIN');

    const createRes = await request(app)
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Organization-Id', 'org_a')
      .send({ name: 'Nope' })
      .expect(403);
    expect(createRes.body.error.code).toBe('AUTHZ_FORBIDDEN');

    const getRes = await request(app)
      .get('/api/v1/projects/proj_live')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Organization-Id', 'org_a')
      .expect(403);
    expect(getRes.body.error.code).toBe('AUTHZ_FORBIDDEN');
  });

  it('lists live non-archived projects for ORG_ADMIN including ones without ProjectMember', async () => {
    const store = emptyStore();
    const user = storedUser();
    store.users.push(user);
    seedOrg(store, { id: 'org_a', name: 'Acme' });
    seedOrgMember(store, { organizationId: 'org_a', userId: 'user_1', role: 'ORG_ADMIN', status: 'ACTIVE' });
    seedProject(store, { id: 'p_active', organizationId: 'org_a', name: 'Active', ownerId: 'user_1', status: 'ACTIVE' });
    seedProject(store, {
      id: 'p_arch',
      organizationId: 'org_a',
      name: 'Archived',
      ownerId: 'user_1',
      status: 'ARCHIVED',
    });
    seedProject(store, {
      id: 'p_del',
      organizationId: 'org_a',
      name: 'Deleted',
      ownerId: 'user_1',
      deletedAt: now,
    });
    const { app } = projectApp(user, store);
    const token = await bearer('user_1');

    const res = await request(app)
      .get('/api/v1/projects')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Organization-Id', 'org_a')
      .expect(200);

    const ids = res.body.data.projects.map((project: Project) => project.id);
    expect(ids).toEqual(['p_active']);
    expect(res.body.meta).toMatchObject({ page: 1, pageSize: 20, total: 1, totalPages: 1 });
  });

  it('paginates the project list', async () => {
    const store = emptyStore();
    const user = storedUser();
    store.users.push(user);
    seedOrg(store, { id: 'org_a', name: 'Acme' });
    seedOrgMember(store, { organizationId: 'org_a', userId: 'user_1', role: 'ORG_ADMIN', status: 'ACTIVE' });
    seedProject(store, { id: 'p3', organizationId: 'org_a', name: 'C', ownerId: 'user_1' });
    seedProject(store, { id: 'p2', organizationId: 'org_a', name: 'B', ownerId: 'user_1' });
    seedProject(store, { id: 'p1', organizationId: 'org_a', name: 'A', ownerId: 'user_1' });
    const { app } = projectApp(user, store);
    const token = await bearer('user_1');

    const res = await request(app)
      .get('/api/v1/projects')
      .query({ page: 1, pageSize: 2 })
      .set('Authorization', `Bearer ${token}`)
      .set('X-Organization-Id', 'org_a')
      .expect(200);

    expect(res.body.data.projects).toHaveLength(2);
    expect(res.body.meta).toMatchObject({ page: 1, pageSize: 2, total: 3, totalPages: 2 });
  });

  it('lists only ProjectMember projects for PROJECT_MANAGER', async () => {
    const store = emptyStore();
    const user = storedUser({ id: 'pm_1' });
    store.users.push(user);
    seedOrg(store, { id: 'org_a', name: 'Acme' });
    seedOrgMember(store, { organizationId: 'org_a', userId: 'pm_1', role: 'PROJECT_MANAGER', status: 'ACTIVE' });
    seedProject(store, { id: 'mine', organizationId: 'org_a', name: 'Mine', ownerId: 'pm_1' });
    seedProject(store, { id: 'theirs', organizationId: 'org_a', name: 'Theirs', ownerId: 'other' });
    seedProjectMember(store, { projectId: 'mine', userId: 'pm_1' });
    const { app } = projectApp(user, store);
    const token = await bearer('pm_1');

    const res = await request(app)
      .get('/api/v1/projects')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Organization-Id', 'org_a')
      .expect(200);
    expect(res.body.data.projects.map((project: Project) => project.id)).toEqual(['mine']);
  });

  it('filters archived projects with status=ARCHIVED', async () => {
    const store = emptyStore();
    const user = storedUser();
    store.users.push(user);
    seedOrg(store, { id: 'org_a', name: 'Acme' });
    seedOrgMember(store, { organizationId: 'org_a', userId: 'user_1', role: 'ORG_ADMIN', status: 'ACTIVE' });
    seedProject(store, { id: 'p_active', organizationId: 'org_a', name: 'Active', ownerId: 'user_1' });
    seedProject(store, {
      id: 'p_arch',
      organizationId: 'org_a',
      name: 'Archived',
      ownerId: 'user_1',
      status: 'ARCHIVED',
    });
    const { app } = projectApp(user, store);
    const token = await bearer('user_1');

    const res = await request(app)
      .get('/api/v1/projects')
      .query({ status: 'ARCHIVED' })
      .set('Authorization', `Bearer ${token}`)
      .set('X-Organization-Id', 'org_a')
      .expect(200);
    expect(res.body.data.projects.map((project: Project) => project.id)).toEqual(['p_arch']);
  });

  it('lets TEAM_MEMBER GET a project they are a ProjectMember of', async () => {
    const store = emptyStore();
    const user = storedUser({ id: 'tm_1' });
    store.users.push(user);
    seedOrg(store, { id: 'org_a', name: 'Acme' });
    seedOrgMember(store, { organizationId: 'org_a', userId: 'tm_1', role: 'TEAM_MEMBER', status: 'ACTIVE' });
    seedProject(store, { id: 'proj_1', organizationId: 'org_a', name: 'Website', ownerId: 'other' });
    seedProjectMember(store, { projectId: 'proj_1', userId: 'tm_1' });
    const { app } = projectApp(user, store);
    const token = await bearer('tm_1');

    const res = await request(app)
      .get('/api/v1/projects/proj_1')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.data.project.id).toBe('proj_1');
  });

  it('lets ORG_ADMIN GET a project without ProjectMember', async () => {
    const store = emptyStore();
    const user = storedUser();
    store.users.push(user);
    seedOrg(store, { id: 'org_a', name: 'Acme' });
    seedOrgMember(store, { organizationId: 'org_a', userId: 'user_1', role: 'ORG_ADMIN', status: 'ACTIVE' });
    seedProject(store, { id: 'proj_1', organizationId: 'org_a', name: 'Website', ownerId: 'other' });
    const { app } = projectApp(user, store);
    const token = await bearer('user_1');

    const res = await request(app)
      .get('/api/v1/projects/proj_1')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.data.project.id).toBe('proj_1');
  });

  it('rejects PROJECT_MANAGER GET without ProjectMember', async () => {
    const store = emptyStore();
    const user = storedUser({ id: 'pm_1' });
    store.users.push(user);
    seedOrg(store, { id: 'org_a', name: 'Acme' });
    seedOrgMember(store, { organizationId: 'org_a', userId: 'pm_1', role: 'PROJECT_MANAGER', status: 'ACTIVE' });
    seedProject(store, { id: 'proj_1', organizationId: 'org_a', name: 'Website', ownerId: 'other' });
    const { app } = projectApp(user, store);
    const token = await bearer('pm_1');

    const res = await request(app)
      .get('/api/v1/projects/proj_1')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
    expect(res.body.error.message).toBe(AUTHZ_FORBIDDEN_MESSAGE);
  });

  it('does not grant by-id access via X-Organization-Id of another org', async () => {
    const store = emptyStore();
    const user = storedUser();
    store.users.push(user);
    seedOrg(store, { id: 'org_a', name: 'Acme' });
    seedOrg(store, { id: 'org_b', name: 'Beta' });
    seedOrgMember(store, { organizationId: 'org_a', userId: 'user_1', role: 'ORG_ADMIN', status: 'ACTIVE' });
    seedProject(store, { id: 'proj_b', organizationId: 'org_b', name: 'Secret', ownerId: 'other' });
    const { app } = projectApp(user, store);
    const token = await bearer('user_1');

    const res = await request(app)
      .get('/api/v1/projects/proj_b')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Organization-Id', 'org_a')
      .expect(403);
    expect(res.body.error.code).toBe('AUTHZ_FORBIDDEN');
  });

  it('returns 404 for missing or soft-deleted projects', async () => {
    const store = emptyStore();
    const user = storedUser();
    store.users.push(user);
    seedOrg(store, { id: 'org_a', name: 'Acme' });
    seedOrgMember(store, { organizationId: 'org_a', userId: 'user_1', role: 'ORG_ADMIN', status: 'ACTIVE' });
    seedProject(store, {
      id: 'proj_del',
      organizationId: 'org_a',
      name: 'Gone',
      ownerId: 'user_1',
      deletedAt: now,
    });
    const { app } = projectApp(user, store);
    const token = await bearer('user_1');

    const missing = await request(app)
      .get('/api/v1/projects/nope')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
    expect(missing.body.error.message).toBe(PROJECT_NOT_FOUND_MESSAGE);

    const deleted = await request(app)
      .get('/api/v1/projects/proj_del')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
    expect(deleted.body.error.message).toBe(PROJECT_NOT_FOUND_MESSAGE);
  });

  it('archives via PATCH status without setting deletedAt', async () => {
    const store = emptyStore();
    const user = storedUser({ id: 'pm_1' });
    store.users.push(user);
    seedOrg(store, { id: 'org_a', name: 'Acme' });
    seedOrgMember(store, { organizationId: 'org_a', userId: 'pm_1', role: 'PROJECT_MANAGER', status: 'ACTIVE' });
    seedProject(store, { id: 'proj_1', organizationId: 'org_a', name: 'Website', ownerId: 'pm_1' });
    seedProjectMember(store, { projectId: 'proj_1', userId: 'pm_1' });
    const { app } = projectApp(user, store);
    const token = await bearer('pm_1');

    const patchRes = await request(app)
      .patch('/api/v1/projects/proj_1')
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'ARCHIVED' })
      .expect(200);
    expect(patchRes.body.data.project.status).toBe('ARCHIVED');
    expect(patchRes.body.data.project.deletedAt).toBeNull();

    const listRes = await request(app)
      .get('/api/v1/projects')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Organization-Id', 'org_a')
      .expect(200);
    expect(listRes.body.data.projects).toHaveLength(0);

    await request(app).get('/api/v1/projects/proj_1').set('Authorization', `Bearer ${token}`).expect(200);
  });

  it('rejects TEAM_MEMBER mutations', async () => {
    const store = emptyStore();
    const user = storedUser({ id: 'tm_1' });
    store.users.push(user);
    seedOrg(store, { id: 'org_a', name: 'Acme' });
    seedOrgMember(store, { organizationId: 'org_a', userId: 'tm_1', role: 'TEAM_MEMBER', status: 'ACTIVE' });
    seedProject(store, { id: 'proj_1', organizationId: 'org_a', name: 'Website', ownerId: 'other' });
    seedProjectMember(store, { projectId: 'proj_1', userId: 'tm_1' });
    const { app } = projectApp(user, store);
    const token = await bearer('tm_1');

    await request(app)
      .patch('/api/v1/projects/proj_1')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Hack' })
      .expect(403);
    await request(app).delete('/api/v1/projects/proj_1').set('Authorization', `Bearer ${token}`).expect(403);
    expect(store.projects[0]?.name).toBe('Website');
    expect(store.projects[0]?.deletedAt).toBeNull();
  });

  it('soft-deletes a project, invokes the cascade hook, and returns 404 afterwards', async () => {
    const store = emptyStore();
    const user = storedUser();
    store.users.push(user);
    seedOrg(store, { id: 'org_a', name: 'Acme' });
    seedOrgMember(store, { organizationId: 'org_a', userId: 'user_1', role: 'ORG_ADMIN', status: 'ACTIVE' });
    seedProject(store, { id: 'proj_1', organizationId: 'org_a', name: 'Website', ownerId: 'user_1' });
    const spy = jest.spyOn(projectSoftDeleteCascade, 'cascadeProjectSoftDeleteChildren');
    const { app } = projectApp(user, store);
    const token = await bearer('user_1');

    const res = await request(app).delete('/api/v1/projects/proj_1').set('Authorization', `Bearer ${token}`).expect(200);
    expect(res.body.data.project.deletedAt).toBeTruthy();
    expect(spy).toHaveBeenCalledWith(expect.anything(), 'proj_1');
    spy.mockRestore();

    await request(app).get('/api/v1/projects/proj_1').set('Authorization', `Bearer ${token}`).expect(404);
    const listRes = await request(app)
      .get('/api/v1/projects')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Organization-Id', 'org_a')
      .expect(200);
    expect(listRes.body.data.projects).toHaveLength(0);

    await request(app).delete('/api/v1/projects/proj_1').set('Authorization', `Bearer ${token}`).expect(404);
  });

  it('rejects PATCH of a deleted project and invalid ownerId', async () => {
    const store = emptyStore();
    const user = storedUser();
    store.users.push(user);
    seedOrg(store, { id: 'org_a', name: 'Acme' });
    seedOrgMember(store, { organizationId: 'org_a', userId: 'user_1', role: 'ORG_ADMIN', status: 'ACTIVE' });
    seedProject(store, {
      id: 'proj_del',
      organizationId: 'org_a',
      name: 'Gone',
      ownerId: 'user_1',
      deletedAt: now,
    });
    seedProject(store, { id: 'proj_1', organizationId: 'org_a', name: 'Live', ownerId: 'user_1' });
    const { app } = projectApp(user, store);
    const token = await bearer('user_1');

    await request(app)
      .patch('/api/v1/projects/proj_del')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Nope' })
      .expect(404);

    const ownerRes = await request(app)
      .patch('/api/v1/projects/proj_1')
      .set('Authorization', `Bearer ${token}`)
      .send({ ownerId: 'stranger' })
      .expect(400);
    expect(ownerRes.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects PENDING membership, unauthenticated requests, and validation errors', async () => {
    const store = emptyStore();
    const pending = storedUser({ id: 'pending_1', email: 'pending@example.com' });
    const admin = storedUser();
    store.users.push(pending, admin);
    seedOrg(store, { id: 'org_a', name: 'Acme' });
    seedOrgMember(store, { organizationId: 'org_a', userId: 'pending_1', role: 'TEAM_MEMBER', status: 'PENDING' });
    seedOrgMember(store, { organizationId: 'org_a', userId: 'user_1', role: 'ORG_ADMIN', status: 'ACTIVE' });
    seedProject(store, { id: 'proj_1', organizationId: 'org_a', name: 'Website', ownerId: 'user_1' });
    const { app } = projectApp(admin, store);

    const pendingToken = await bearer('pending_1', 'pending@example.com');
    const pendingRes = await request(app)
      .get('/api/v1/projects')
      .set('Authorization', `Bearer ${pendingToken}`)
      .set('X-Organization-Id', 'org_a')
      .expect(403);
    expect(pendingRes.body.error.code).toBe('AUTHZ_FORBIDDEN');

    const unauth = await request(app).get('/api/v1/projects/proj_1').expect(401);
    expect(unauth.body.error.message).toBe(AUTH_SESSION_UNAUTHORIZED_MESSAGE);

    const token = await bearer('user_1');
    await request(app)
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Organization-Id', 'org_a')
      .send({ name: '   ' })
      .expect(400);
    await request(app)
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Organization-Id', 'org_a')
      .send({
        name: 'Dates',
        startDate: '2026-12-01T00:00:00.000Z',
        dueDate: '2026-01-01T00:00:00.000Z',
      })
      .expect(400);
    await request(app)
      .patch('/api/v1/projects/proj_1')
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(400);
    await request(app)
      .patch('/api/v1/projects/proj_1')
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'NOPE' })
      .expect(400);

    const deletedHeaderOrg = seedOrg(store, { id: 'org_gone', name: 'Gone', deletedAt: now });
    void deletedHeaderOrg;
    const gone = await request(app)
      .get('/api/v1/projects')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Organization-Id', 'org_gone')
      .expect(404);
    expect(gone.body.error.message).toBe(ORGANIZATION_NOT_FOUND_MESSAGE);
  });
});
