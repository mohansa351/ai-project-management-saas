import type { Request, Response } from 'express';
import { z } from 'zod';
import { AppError } from '../lib/http/appError.js';
import { AUTH_SESSION_UNAUTHORIZED_MESSAGE } from '../lib/http/authErrors.js';
import { ORG_CONTEXT_REQUIRED_MESSAGE } from '../lib/http/orgErrors.js';
import { success } from '../lib/http/envelope.js';
import type { PublicUser } from '../services/authService.js';
import type { ProjectService } from '../services/projectService.js';

const projectStatusSchema = z.enum(['PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'ARCHIVED']);
const projectPrioritySchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
const isoDateSchema = z.string().datetime().transform((value) => new Date(value));

const createBodySchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.union([z.string().max(4000), z.null()]).optional(),
  status: projectStatusSchema.optional(),
  priority: projectPrioritySchema.optional(),
  startDate: isoDateSchema.optional(),
  dueDate: isoDateSchema.optional(),
  organizationId: z.string().min(1).optional(),
});

const patchBodySchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    description: z.union([z.string().max(4000), z.null()]).optional(),
    status: projectStatusSchema.optional(),
    priority: projectPrioritySchema.optional(),
    startDate: isoDateSchema.optional(),
    dueDate: isoDateSchema.optional(),
    ownerId: z.string().min(1).optional(),
    organizationId: z.string().optional(),
  })
  .superRefine((body, ctx) => {
    if (body.organizationId !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'organizationId cannot be changed',
        path: ['organizationId'],
      });
    }
    if (
      body.name === undefined &&
      body.description === undefined &&
      body.status === undefined &&
      body.priority === undefined &&
      body.startDate === undefined &&
      body.dueDate === undefined &&
      body.ownerId === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'At least one field is required',
        path: ['name'],
      });
    }
  });

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: projectStatusSchema.optional(),
});

function sessionUnauthorized(): AppError {
  return new AppError('AUTH_UNAUTHORIZED', AUTH_SESSION_UNAUTHORIZED_MESSAGE, 401);
}

function missingOrgContext(): AppError {
  return new AppError('VALIDATION_ERROR', ORG_CONTEXT_REQUIRED_MESSAGE, 400, {
    'x-organization-id': [ORG_CONTEXT_REQUIRED_MESSAGE],
  });
}

function requireUser(req: Request): PublicUser {
  if (!req.user) {
    throw sessionUnauthorized();
  }
  return req.user;
}

function requireOrganizationId(req: Request): string {
  if (!req.organizationId) {
    throw missingOrgContext();
  }
  return req.organizationId;
}

function routeId(req: Request): string {
  const id = req.params.id;
  return typeof id === 'string' ? id : '';
}

export class ProjectController {
  constructor(private readonly projectService: ProjectService) {}

  create = async (req: Request, res: Response): Promise<void> => {
    const userId = requireUser(req).id;
    const organizationId = requireOrganizationId(req);
    const parsed = createBodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Validation failed', 400, parsed.error.flatten().fieldErrors);
    }
    const project = await this.projectService.create(userId, organizationId, parsed.data);
    res.status(201).json(success({ project }));
  };

  list = async (req: Request, res: Response): Promise<void> => {
    const userId = requireUser(req).id;
    const organizationId = requireOrganizationId(req);
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Validation failed', 400, parsed.error.flatten().fieldErrors);
    }
    const result = await this.projectService.list(userId, organizationId, parsed.data);
    res.status(200).json(success({ projects: result.projects }, result.meta));
  };

  getById = async (req: Request, res: Response): Promise<void> => {
    const userId = requireUser(req).id;
    const project = await this.projectService.getById(userId, routeId(req));
    res.status(200).json(success({ project }));
  };

  patch = async (req: Request, res: Response): Promise<void> => {
    const userId = requireUser(req).id;
    const parsed = patchBodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Validation failed', 400, parsed.error.flatten().fieldErrors);
    }
    const { organizationId: _ignored, ...patch } = parsed.data;
    void _ignored;
    const project = await this.projectService.patch(userId, routeId(req), patch);
    res.status(200).json(success({ project }));
  };

  remove = async (req: Request, res: Response): Promise<void> => {
    const userId = requireUser(req).id;
    const project = await this.projectService.softDelete(userId, routeId(req));
    res.status(200).json(success({ project }));
  };
}

export function dummyProjectController(): ProjectController {
  return {
    create: unusedProjectHandler,
    list: unusedProjectHandler,
    getById: unusedProjectHandler,
    patch: unusedProjectHandler,
    remove: unusedProjectHandler,
  } as unknown as ProjectController;
}

async function unusedProjectHandler(_req: Request, res: Response): Promise<void> {
  res.status(404).end();
}
