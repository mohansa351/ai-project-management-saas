import type { Organization, PrismaClient } from '@prisma/client';
import { AppError } from '../lib/http/appError.js';
import { ORGANIZATION_NOT_FOUND_MESSAGE } from '../lib/http/orgErrors.js';
import type { OrganizationMemberRepository } from '../repositories/organizationMemberRepository.js';
import type { OrganizationRepository } from '../repositories/organizationRepository.js';
import { assertOrgMember, assertPermission } from './authz/assert.js';

export type PublicOrganization = {
  id: string;
  name: string;
  slug: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};

export type CreateOrganizationInput = {
  name: string;
  slug?: string;
};

export type PatchOrganizationInput = {
  name?: string;
  slug?: string;
};

export type ListOrganizationsInput = {
  page: number;
  pageSize: number;
};

export type ListOrganizationsResult = {
  organizations: PublicOrganization[];
  meta: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
};

function notFound(): AppError {
  return new AppError('NOT_FOUND', ORGANIZATION_NOT_FOUND_MESSAGE, 404);
}

export function toPublicOrganization(organization: Organization): PublicOrganization {
  return {
    id: organization.id,
    name: organization.name,
    slug: organization.slug,
    createdAt: organization.createdAt,
    updatedAt: organization.updatedAt,
    deletedAt: organization.deletedAt,
  };
}

export class OrganizationService {
  constructor(
    private readonly organizationRepository: OrganizationRepository,
    private readonly organizationMemberRepository: OrganizationMemberRepository,
    private readonly prisma: PrismaClient,
  ) {}

  async create(userId: string, input: CreateOrganizationInput): Promise<PublicOrganization> {
    const organization = await this.prisma.$transaction(async (tx) => {
      const created = await this.organizationRepository.create(
        { name: input.name, slug: input.slug },
        tx,
      );
      await this.organizationMemberRepository.upsertOrgAdmin(created.id, userId, tx);
      return created;
    });
    return toPublicOrganization(organization);
  }

  async list(userId: string, input: ListOrganizationsInput): Promise<ListOrganizationsResult> {
    const { organizations, total } = await this.organizationRepository.listLiveForUser({
      userId,
      page: input.page,
      pageSize: input.pageSize,
    });
    return {
      organizations: organizations.map(toPublicOrganization),
      meta: {
        page: input.page,
        pageSize: input.pageSize,
        total,
        totalPages: input.pageSize === 0 ? 0 : Math.ceil(total / input.pageSize),
      },
    };
  }

  async getById(userId: string, organizationId: string): Promise<PublicOrganization> {
    const { organization } = await this.orgMember(userId, organizationId);
    return toPublicOrganization(organization);
  }

  async patch(
    userId: string,
    organizationId: string,
    input: PatchOrganizationInput,
  ): Promise<PublicOrganization> {
    await this.requireOrgManage(userId, organizationId);
    const updated = await this.organizationRepository.updateLive(organizationId, input);
    if (!updated) {
      throw notFound();
    }
    return toPublicOrganization(updated);
  }

  async softDelete(userId: string, organizationId: string): Promise<PublicOrganization> {
    await this.requireOrgManage(userId, organizationId);
    const deleted = await this.organizationRepository.softDelete(organizationId);
    if (!deleted) {
      throw notFound();
    }
    return toPublicOrganization(deleted);
  }

  private orgMember(userId: string, organizationId: string) {
    return assertOrgMember(
      {
        organizationRepository: this.organizationRepository,
        organizationMemberRepository: this.organizationMemberRepository,
      },
      userId,
      organizationId,
    );
  }

  private async requireOrgManage(userId: string, organizationId: string): Promise<void> {
    const { member } = await this.orgMember(userId, organizationId);
    assertPermission(member.role, 'org.manage');
  }
}
