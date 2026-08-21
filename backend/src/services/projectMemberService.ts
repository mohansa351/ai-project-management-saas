import type { OrganizationMember, Project } from '@prisma/client';
import { AppError } from '../lib/http/appError.js';
import {
  DUPLICATE_PROJECT_MEMBER_ERROR,
  INVALID_PROJECT_MEMBER_USER_ERROR,
  PROJECT_MEMBER_NOT_FOUND_MESSAGE,
} from '../lib/http/projectErrors.js';
import type { OrganizationMemberRepository } from '../repositories/organizationMemberRepository.js';
import type { OrganizationRepository } from '../repositories/organizationRepository.js';
import type {
  ProjectMemberRepository,
  ProjectMemberWithUser,
} from '../repositories/projectMemberRepository.js';
import type { ProjectRepository } from '../repositories/projectRepository.js';
import { assertPermission, assertProjectMember } from './authz/assert.js';

export type PublicProjectMember = {
  id: string;
  projectId: string;
  userId: string;
  createdAt: Date;
  updatedAt: Date;
  user: {
    id: string;
    email: string;
    name: string;
  };
};

export type ListProjectMembersInput = {
  page: number;
  pageSize: number;
};

export type ListProjectMembersResult = {
  members: PublicProjectMember[];
  meta: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
};

function memberNotFound(): AppError {
  return new AppError('NOT_FOUND', PROJECT_MEMBER_NOT_FOUND_MESSAGE, 404);
}

function invalidTargetUser(): AppError {
  return new AppError(
    'VALIDATION_ERROR',
    INVALID_PROJECT_MEMBER_USER_ERROR.message,
    400,
    INVALID_PROJECT_MEMBER_USER_ERROR.details,
  );
}

export function toPublicProjectMember(member: ProjectMemberWithUser): PublicProjectMember {
  return {
    id: member.id,
    projectId: member.projectId,
    userId: member.userId,
    createdAt: member.createdAt,
    updatedAt: member.updatedAt,
    user: {
      id: member.user.id,
      email: member.user.email,
      name: member.user.name,
    },
  };
}

export class ProjectMemberService {
  constructor(
    private readonly projectRepository: ProjectRepository,
    private readonly projectMemberRepository: ProjectMemberRepository,
    private readonly organizationRepository: OrganizationRepository,
    private readonly organizationMemberRepository: OrganizationMemberRepository,
  ) {}

  async list(
    actorUserId: string,
    projectId: string,
    input: ListProjectMembersInput,
  ): Promise<ListProjectMembersResult> {
    await this.projectAccess(actorUserId, projectId);
    const { members, total } = await this.projectMemberRepository.listByProject({
      projectId,
      page: input.page,
      pageSize: input.pageSize,
    });
    return {
      members: members.map(toPublicProjectMember),
      meta: {
        page: input.page,
        pageSize: input.pageSize,
        total,
        totalPages: input.pageSize === 0 ? 0 : Math.ceil(total / input.pageSize),
      },
    };
  }

  async add(actorUserId: string, projectId: string, targetUserId: string): Promise<PublicProjectMember> {
    const { project } = await this.requireMembersManage(actorUserId, projectId);
    const orgMembership = await this.organizationMemberRepository.findActiveByOrgAndUser(
      project.organizationId,
      targetUserId,
    );
    if (!orgMembership) {
      throw invalidTargetUser();
    }
    const existing = await this.projectMemberRepository.findByProjectAndUser(projectId, targetUserId);
    if (existing) {
      throw new AppError(
        'VALIDATION_ERROR',
        DUPLICATE_PROJECT_MEMBER_ERROR.message,
        400,
        DUPLICATE_PROJECT_MEMBER_ERROR.details,
      );
    }
    const created = await this.projectMemberRepository.createForUser(projectId, targetUserId);
    // Story 4.4: ActivityLogService
    return toPublicProjectMember(created);
  }

  async remove(actorUserId: string, projectId: string, memberId: string): Promise<PublicProjectMember> {
    await this.requireMembersManage(actorUserId, projectId);
    const target = await this.projectMemberRepository.findById(memberId);
    if (!target || target.projectId !== projectId) {
      throw memberNotFound();
    }
    await this.projectMemberRepository.deleteById(target.id);
    // Story 4.4: ActivityLogService
    return toPublicProjectMember(target);
  }

  private projectAccess(userId: string, projectId: string) {
    return assertProjectMember(this.authzRepos(), userId, projectId);
  }

  private async requireMembersManage(
    userId: string,
    projectId: string,
  ): Promise<{ project: Project; member: OrganizationMember }> {
    const { project, member } = await this.projectAccess(userId, projectId);
    assertPermission(member.role, 'project.members.manage');
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
