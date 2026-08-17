import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express, type RequestHandler } from 'express';
import helmet from 'helmet';
import { env } from './config/env.js';
import type { AuthController } from './controllers/authController.js';
import type { HealthController } from './controllers/healthController.js';
import { AppError } from './lib/http/appError.js';
import { errorHandler } from './middleware/errorHandler.js';
import { requestId } from './middleware/requestId.js';
import { createV1Router } from './routes/v1/index.js';

export type AppControllers = {
  healthController: HealthController;
  authController: AuthController;
  authRateLimit?: RequestHandler;
};

export function createApp({ healthController, authController, authRateLimit }: AppControllers): Express {
  const app = express();

  app.use(helmet());
  app.use(
    cors({
      origin: env.CORS_ORIGIN,
      credentials: true,
    }),
  );
  app.use(requestId);
  app.use(express.json());
  app.use(cookieParser());

  app.get('/health', healthController.getHealth);
  app.use('/api/v1', createV1Router(healthController, authController, authRateLimit));

  if (env.NODE_ENV === 'test') {
    app.get('/__test/error', () => {
      throw new AppError('TEST_ERROR', 'controlled failure', 400, { field: 'x' });
    });
  }

  app.use(errorHandler);

  return app;
}
