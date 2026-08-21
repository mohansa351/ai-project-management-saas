import type { OrganizationMember, PrismaClient, Project, ProjectPriority, ProjectStatus } from '@prisma/client';
import { AppError } from '../lib/http/appError.js';
import {
  INVALID_PROJECT_OWNER_ERROR,
  PROJECT_DATE_RANGE_ERROR,
  PROJECT_NOT_FOUND_MESSAGE,
  PROJECT_ORG_MISMATCH_ERROR,
} from '../lib/http/projectErrors.js';
import type { OrganizationMemberRepository } from '../repositories/organizationMemberRepository.js';
import type { OrganizationRepository } from '../repositories/organizationRepository.js';
import type { ProjectMemberRepository } from '../repositories/projectMemberRepository.js';
import type { ProjectRepository } from '../repositories/projectRepository.js';
import { assertOrgMember, assertPermission, assertProjectMember } from './authz/assert.js';
import { canAccessAnyOrgProject } from './authz/permissions.js';

export type PublicProject = {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  priority: ProjectPriority;
  startDate: Date | null;
  dueDate: Date | null;
  ownerId: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};

export type CreateProjectInput = {
  name: string;
  description?: string | null;
  status?: ProjectStatus;
  priority?: ProjectPriority;
  startDate?: Date | null;
  dueDate?: Date | null;
  organizationId?: string;
};

export type PatchProjectInput = {
  name?: string;
  description?: string | null;
  status?: ProjectStatus;
  priority?: ProjectPriority;
  startDate?: Date;
  dueDate?: Date;
  ownerId?: string;
};

export type ListProjectsInput = {
  page: number;
  pageSize: number;
  status?: ProjectStatus;
};

export type ListProjectsResult = {
  projects: PublicProject[];
  meta: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
};

function projectNotFound(): AppError {
  return new AppError('NOT_FOUND', PROJECT_NOT_FOUND_MESSAGE, 404);
}

function dateRangeError(): AppError {
  return new AppError('VALIDATION_ERROR', PROJECT_DATE_RANGE_ERROR.message, 400, PROJECT_DATE_RANGE_ERROR.details);
}

function ownerError(): AppError {
  return new AppError(
    'VALIDATION_ERROR',
    INVALID_PROJECT_OWNER_ERROR.message,
    400,
    INVALID_PROJECT_OWNER_ERROR.details,
  );
}

function orgMismatch(): AppError {
  return new AppError(
    'VALIDATION_ERROR',
    PROJECT_ORG_MISMATCH_ERROR.message,
    400,
    PROJECT_ORG_MISMATCH_ERROR.details,
  );
}

function assertDateRange(startDate: Date | null | undefined, dueDate: Date | null | undefined): void {
  if (startDate && dueDate && dueDate.getTime() < startDate.getTime()) {
    throw dateRangeError();
  }
}

export function toPublicProject(project: Project): PublicProject {
  return {
    id: project.id,
    organizationId: project.organizationId,
    name: project.name,
    description: project.description,
    status: project.status,
    priority: project.priority,
    startDate: project.startDate,
    dueDate: project.dueDate,
    ownerId: project.ownerId,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    deletedAt: project.deletedAt,
  };
}

export class ProjectService {
  constructor(
    private readonly projectRepository: ProjectRepository,
    private readonly projectMemberRepository: ProjectMemberRepository,
    private readonly organizationRepository: OrganizationRepository,
    private readonly organizationMemberRepository: OrganizationMemberRepository,
    private readonly prisma: PrismaClient,
  ) {}

  async create(userId: string, organizationId: string, input: CreateProjectInput): Promise<PublicProject> {
    const { member } = await this.orgMember(userId, organizationId);
    assertPermission(member.role, 'project.create');
    if (input.organizationId !== undefined && input.organizationId !== organizationId) {
      throw orgMismatch();
    }
    const description = normalizeDescription(input.description);
    const startDate = input.startDate ?? null;
    const dueDate = input.dueDate ?? null;
    assertDateRange(startDate, dueDate);
    const project = await this.prisma.$transaction(async (tx) => {
      const created = await this.projectRepository.create(
        {
          organizationId,
          name: input.name,
          description,
          status: input.status ?? 'PLANNING',
          priority: input.priority ?? 'MEDIUM',
          startDate,
          dueDate,
          ownerId: userId,
        },
        tx,
      );
      await this.projectMemberRepository.upsertForUser(created.id, userId, tx);
      return created;
    });
    // Story 4.4: ActivityLogService
    return toPublicProject(project);
  }

  async list(userId: string, organizationId: string, input: ListProjectsInput): Promise<ListProjectsResult> {
    const { member } = await this.orgMember(userId, organizationId);
    const query = {
      organizationId,
      page: input.page,
      pageSize: input.pageSize,
      status: input.status,
    };
    const { projects, total } = canAccessAnyOrgProject(member.role)
      ? await this.projectRepository.listLiveForOrg(query)
      : await this.projectRepository.listLiveForMember({ ...query, userId });
    return {
      projects: projects.map(toPublicProject),
      meta: {
        page: input.page,
        pageSize: input.pageSize,
        total,
        totalPages: input.pageSize === 0 ? 0 : Math.ceil(total / input.pageSize),
      },
    };
  }

  async getById(userId: string, projectId: string): Promise<PublicProject> {
    const { project } = await this.projectAccess(userId, projectId);
    return toPublicProject(project);
  }

  async patch(userId: string, projectId: string, input: PatchProjectInput): Promise<PublicProject> {
    const { project } = await this.requireProjectMutate(userId, projectId);
    assertDateRange(input.startDate ?? project.startDate, input.dueDate ?? project.dueDate);
    if (input.ownerId !== undefined) {
      const ownerMembership = await this.organizationMemberRepository.findActiveByOrgAndUser(
        project.organizationId,
        input.ownerId,
      );
      if (!ownerMembership) {
        throw ownerError();
      }
    }
    const updated = await this.projectRepository.updateLive(projectId, {
      ...input,
      ...(input.description !== undefined ? { description: normalizeDescription(input.description) } : {}),
    });
    if (!updated) {
      throw projectNotFound();
    }
    // Story 4.4: ActivityLogService
    return toPublicProject(updated);
  }

  async softDelete(userId: string, projectId: string): Promise<PublicProject> {
    await this.requireProjectMutate(userId, projectId);
    const deleted = await this.prisma.$transaction(async (tx) => {
      return this.projectRepository.softDelete(projectId, tx);
    });
    if (!deleted) {
      throw projectNotFound();
    }
    // Story 4.4: ActivityLogService
    return toPublicProject(deleted);
  }

  private orgMember(userId: string, organizationId: string) {
    return assertOrgMember(this.authzRepos(), userId, organizationId);
  }

  private projectAccess(userId: string, projectId: string) {
    return assertProjectMember(this.authzRepos(), userId, projectId);
  }

  private async requireProjectMutate(
    userId: string,
    projectId: string,
  ): Promise<{ project: Project; member: OrganizationMember }> {
    const { project, member } = await this.projectAccess(userId, projectId);
    assertPermission(member.role, 'project.create');
    return { project, member };
  }

  private authzRepos() {
    return {
      organizationRepository: this.organizationRepository,
      organizationMemberRepository: this.organizationMemberRepository,
      projectRepository: this.projectRepository,
      projectMemberRepository: this.projectMemberRepository,
    };
  }
}

function normalizeDescription(description: string | null | undefined): string | null {
  if (description === undefined || description === null) {
    return null;
  }
  const trimmed = description.trim();
  return trimmed.length === 0 ? null : trimmed;
}
