import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { env } from './config/env.js';
import type { HealthController } from './controllers/healthController.js';
import { AppError } from './lib/http/appError.js';
import { errorHandler } from './middleware/errorHandler.js';
import { requestId } from './middleware/requestId.js';
import { createV1Router } from './routes/v1/index.js';

export function createApp(healthController: HealthController): Express {
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

  app.get('/health', healthController.getHealth);
  app.use('/api/v1', createV1Router(healthController));

  if (env.NODE_ENV === 'test') {
    app.get('/__test/error', () => {
      throw new AppError('TEST_ERROR', 'controlled failure', 400, { field: 'x' });
    });
  }

  app.use(errorHandler);

  return app;
}
