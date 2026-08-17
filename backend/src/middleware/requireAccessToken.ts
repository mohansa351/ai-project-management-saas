import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../lib/http/appError.js';
import { AUTH_SESSION_UNAUTHORIZED_MESSAGE } from '../lib/http/authErrors.js';
import { verifyAccessToken } from '../lib/jwt.js';
import type { UserRepository } from '../repositories/userRepository.js';
import { toPublicUser } from '../services/authService.js';

function sessionUnauthorized(): AppError {
  return new AppError('AUTH_UNAUTHORIZED', AUTH_SESSION_UNAUTHORIZED_MESSAGE, 401);
}

export function createRequireAccessToken(userRepository: UserRepository) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const header = req.get('authorization');
      if (!header) {
        throw sessionUnauthorized();
      }
      const parts = header.trim().split(/\s+/);
      const scheme = parts[0];
      const token = parts[1];
      if (parts.length !== 2 || !scheme || scheme.toLowerCase() !== 'bearer' || !token) {
        throw sessionUnauthorized();
      }

      const claims = await verifyAccessToken(token);
      const user = await userRepository.findById(claims.sub);
      if (!user || !user.isActive || !user.emailVerifiedAt) {
        throw sessionUnauthorized();
      }

      req.user = toPublicUser(user);
      next();
    } catch (err) {
      next(err);
    }
  };
}
