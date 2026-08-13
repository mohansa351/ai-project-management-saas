import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { logger } from '../lib/logger.js';

export function requestId(req: Request, res: Response, next: NextFunction): void {
  const inbound = req.header('x-request-id')?.trim();
  const usable = inbound && /^[\w.-]{1,128}$/.test(inbound);
  const id = usable ? inbound : randomUUID();
  req.requestId = id;
  req.log = logger.child({ requestId: id });
  res.setHeader('X-Request-Id', id);
  next();
}
