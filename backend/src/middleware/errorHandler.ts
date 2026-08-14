import type { NextFunction, Request, Response } from 'express';
import { failure } from '../lib/http/envelope.js';
import { AppError } from '../lib/http/appError.js';
import { logger } from '../lib/logger.js';

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(err);
    return;
  }
  const appErr = err instanceof AppError ? err : null;
  const statusCode = appErr?.statusCode ?? 500;
  const code = appErr?.code ?? 'INTERNAL_ERROR';
  const production = process.env.NODE_ENV === 'production';
  const message =
    production && statusCode >= 500
      ? 'An unexpected error occurred.'
      : appErr?.message ?? (err instanceof Error ? err.message : 'An unexpected error occurred.');

  const log = req.log ?? logger;
  log.error({ err, requestId: req.requestId, code, statusCode }, message);

  const details = production && statusCode >= 500 ? undefined : appErr?.details;
  const body = failure(code, message, details);

  res.status(statusCode).json(body);
}
