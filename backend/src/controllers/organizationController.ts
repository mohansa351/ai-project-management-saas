import type { Request, Response } from 'express';
import { z } from 'zod';
import { AppError } from '../lib/http/appError.js';
import { AUTH_SESSION_UNAUTHORIZED_MESSAGE } from '../lib/http/authErrors.js';
import { success } from '../lib/http/envelope.js';
import type { OrganizationInviteService } from '../services/organizationInviteService.js';
import type { OrganizationMemberService } from '../services/organizationMemberService.js';
import type { OrganizationService } from '../services/organizationService.js';
import type { PublicUser } from '../services/authService.js';

const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

const createBodySchema = z.object({
  name: z.string().trim().min(1).max(100),
  slug: slugSchema.optional(),
});

const patchBodySchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    slug: slugSchema.optional(),
  })
  .superRefine((body, ctx) => {
    if (body.name === undefined && body.slug === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'At least one of name or slug is required',
        path: ['name'],
      });
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'At least one of name or slug is required',
        path: ['slug'],
      });
    }
  });

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const inviteBodySchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  role: z.enum(['ORG_ADMIN', 'PROJECT_MANAGER', 'TEAM_MEMBER']),
});

const acceptBodySchema = z.object({
  token: z.string().trim().min(1),
});

function sessionUnauthorized(): AppError {
  return new AppError('AUTH_UNAUTHORIZED', AUTH_SESSION_UNAUTHORIZED_MESSAGE, 401);
}

function requireUser(req: Request): PublicUser {
  if (!req.user) {
    throw sessionUnauthorized();
  }
  return req.user;
}

function requireUserId(req: Request): string {
  return requireUser(req).id;
}

function routeId(req: Request): string {
  const id = req.params.id;
  return typeof id === 'string' ? id : '';
}

function routeMemberId(req: Request): string {
  const id = req.params.memberId;
  return typeof id === 'string' ? id : '';
}

const patchMemberBodySchema = z.object({
  role: z.enum(['ORG_ADMIN', 'PROJECT_MANAGER', 'TEAM_MEMBER']),
});

export class OrganizationController {
  constructor(
    private readonly organizationService: OrganizationService,
    private readonly organizationInviteService: OrganizationInviteService,
    private readonly organizationMemberService: OrganizationMemberService,
  ) {}

  create = async (req: Request, res: Response): Promise<void> => {
    const userId = requireUserId(req);
    const parsed = createBodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Validation failed', 400, parsed.error.flatten().fieldErrors);
    }
    const organization = await this.organizationService.create(userId, parsed.data);
    res.status(201).json(success({ organization }));
  };

  list = async (req: Request, res: Response): Promise<void> => {
    const userId = requireUserId(req);
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Validation failed', 400, parsed.error.flatten().fieldErrors);
    }
    const result = await this.organizationService.list(userId, parsed.data);
    res.status(200).json(success({ organizations: result.organizations }, result.meta));
  };

  getById = async (req: Request, res: Response): Promise<void> => {
    const userId = requireUserId(req);
    const organization = await this.organizationService.getById(userId, routeId(req));
    res.status(200).json(success({ organization }));
  };

  patch = async (req: Request, res: Response): Promise<void> => {
    const userId = requireUserId(req);
    const parsed = patchBodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Validation failed', 400, parsed.error.flatten().fieldErrors);
    }
    const organization = await this.organizationService.patch(userId, routeId(req), parsed.data);
    res.status(200).json(success({ organization }));
  };

  remove = async (req: Request, res: Response): Promise<void> => {
    const userId = requireUserId(req);
    const organization = await this.organizationService.softDelete(userId, routeId(req));
    res.status(200).json(success({ organization }));
  };

  invite = async (req: Request, res: Response): Promise<void> => {
    const userId = requireUserId(req);
    const parsed = inviteBodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Validation failed', 400, parsed.error.flatten().fieldErrors);
    }
    const invite = await this.organizationInviteService.invite(userId, routeId(req), parsed.data);
    res.status(201).json(success({ invite }));
  };

  accept = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    const parsed = acceptBodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Validation failed', 400, parsed.error.flatten().fieldErrors);
    }
    const membership = await this.organizationInviteService.accept(user, routeId(req), parsed.data.token);
    res.status(200).json(success({ membership }));
  };

  listMembers = async (req: Request, res: Response): Promise<void> => {
    const userId = requireUserId(req);
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Validation failed', 400, parsed.error.flatten().fieldErrors);
    }
    const result = await this.organizationMemberService.list(userId, routeId(req), parsed.data);
    res.status(200).json(success({ members: result.members }, result.meta));
  };

  patchMember = async (req: Request, res: Response): Promise<void> => {
    const userId = requireUserId(req);
    const parsed = patchMemberBodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Validation failed', 400, parsed.error.flatten().fieldErrors);
    }
    const membership = await this.organizationMemberService.patchRole(
      userId,
      routeId(req),
      routeMemberId(req),
      parsed.data.role,
    );
    res.status(200).json(success({ membership }));
  };

  removeMember = async (req: Request, res: Response): Promise<void> => {
    const userId = requireUserId(req);
    const membership = await this.organizationMemberService.remove(userId, routeId(req), routeMemberId(req));
    res.status(200).json(success({ membership }));
  };
}

export function dummyOrganizationController(): OrganizationController {
  return {
    create: unusedOrgHandler,
    list: unusedOrgHandler,
    getById: unusedOrgHandler,
    patch: unusedOrgHandler,
    remove: unusedOrgHandler,
    invite: unusedOrgHandler,
    accept: unusedOrgHandler,
    listMembers: unusedOrgHandler,
    patchMember: unusedOrgHandler,
    removeMember: unusedOrgHandler,
  } as unknown as OrganizationController;
}

async function unusedOrgHandler(_req: Request, res: Response): Promise<void> {
  res.status(404).end();
}
