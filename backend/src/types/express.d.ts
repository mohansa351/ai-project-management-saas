import type { PublicUser } from '../services/authService.js';
import type { Logger } from 'pino';

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      log: Logger;
      user?: PublicUser;
    }
  }
}

export {};
