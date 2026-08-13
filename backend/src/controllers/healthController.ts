import type { Request, Response } from 'express';
import { success } from '../lib/http/envelope.js';
import type { HealthService } from '../services/healthService.js';

export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  getHealth = async (req: Request, res: Response): Promise<void> => {
    const data = await this.healthService.getReadiness();
    if (data.status !== 'ok') {
      req.log.warn(
        { requestId: req.requestId, postgres: data.postgres, redis: data.redis, status: data.status },
        'health dependency not ready',
      );
    }
    res.status(200).json(success(data));
  };
}
