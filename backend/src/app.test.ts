import { describe, expect, it, jest } from '@jest/globals';
import request from 'supertest';
import { createApp } from './app.js';
import { AuthController } from './controllers/authController.js';
import { HealthController } from './controllers/healthController.js';
import { AppError } from './lib/http/appError.js';
import { errorHandler } from './middleware/errorHandler.js';
import { requestId } from './middleware/requestId.js';
import { HealthService, type Readiness } from './services/healthService.js';
import type { Request, Response } from 'express';
import { loadEnv } from './config/env.js';

function mockService(readiness: Readiness): HealthService {
  return {
    getReadiness: jest.fn(async () => readiness),
  } as unknown as HealthService;
}

function stubAuthController(): AuthController {
  return {
    register: jest.fn(),
    login: jest.fn(),
    logout: jest.fn(),
    refresh: jest.fn(),
    me: jest.fn(),
    verifyEmail: jest.fn(),
    resendVerification: jest.fn(),
    forgotPassword: jest.fn(),
    resetPassword: jest.fn(),
  } as unknown as AuthController;
}

function healthApp(readiness: Readiness = okReadiness) {
  return createApp({
    healthController: new HealthController(mockService(readiness)),
    authController: stubAuthController(),
  });
}

const okReadiness: Readiness = {
  status: 'ok',
  postgres: 'up',
  redis: 'up',
  uptime: 12.5,
};

const degradedReadiness: Readiness = {
  status: 'degraded',
  postgres: 'down',
  redis: 'up',
  uptime: 3,
};

describe('health envelopes', () => {
  it('trusts a single proxy hop so rate-limit keys can use X-Forwarded-For', () => {
    expect(healthApp().get('trust proxy')).toBe(1);
  });  it('returns success envelope with readiness fields on GET /health and /api/v1/health', async () => {
    const app = healthApp();

    for (const path of ['/health', '/api/v1/health']) {
      const res = await request(app).get(path).expect(200);
      expect(res.body).toEqual({
        success: true,
        data: okReadiness,
      });
      expect(res.headers['x-request-id']).toEqual(expect.any(String));
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    }
  });

  it('still responds when a dependency is down', async () => {
    const app = healthApp(degradedReadiness);
    const res = await request(app).get('/health').expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('degraded');
    expect(res.body.data.postgres).toBe('down');
  });

  it('logs requestId when a dependency is down', async () => {
    const warn = jest.fn();
    const controller = new HealthController(mockService(degradedReadiness));
    const req = { requestId: 'dep-down-1', log: { warn } } as unknown as Request;
    const json = jest.fn();
    const res = { status: jest.fn().mockReturnValue({ json }) } as unknown as Response;
    await controller.getHealth(req, res);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'dep-down-1', postgres: 'down', status: 'degraded' }),
      'health dependency not ready',
    );
  });
});

describe('request id', () => {
  it('echoes inbound X-Request-Id and generates one when missing', async () => {
    const app = healthApp();

    const inbound = await request(app)
      .get('/health')
      .set('X-Request-Id', 'req-from-client')
      .expect(200);
    expect(inbound.headers['x-request-id']).toBe('req-from-client');

    const generated = await request(app).get('/health').expect(200);
    expect(generated.headers['x-request-id']).toEqual(expect.any(String));
    expect(generated.headers['x-request-id']).not.toBe('');

    const invalid = await request(app)
      .get('/health')
      .set('X-Request-Id', 'bad id with spaces')
      .expect(200);
    expect(invalid.headers['x-request-id']).not.toBe('bad id with spaces');
  });

  it('binds requestId onto the pino child logger', () => {
    const req = { header: () => undefined } as unknown as Request;
    const res = { setHeader: jest.fn() } as unknown as Response;
    requestId(req, res, jest.fn());
    expect(req.requestId).toEqual(expect.any(String));
    expect(req.log.bindings()).toMatchObject({ requestId: req.requestId });
  });
});

describe('CORS', () => {
  it('allows the configured frontend origin with credentials', async () => {
    const app = healthApp();
    const allowed = await request(app)
      .get('/health')
      .set('Origin', 'http://localhost:3000')
      .expect(200);
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');

    const denied = await request(app)
      .get('/health')
      .set('Origin', 'http://evil.example')
      .expect(200);
    expect(denied.headers['access-control-allow-origin']).not.toBe('http://evil.example');
  });
});

describe('error middleware', () => {
  it('returns error envelope and never includes stack in production', () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const req = { requestId: 'err-1', log: { error: jest.fn() } } as unknown as Request;
      const json = jest.fn();
      const res = { status: jest.fn().mockReturnValue({ json }) } as unknown as Response;
      const err = new Error('secret boom');
      err.stack = 'Error: secret boom\n    at Object.<anonymous> (secret.ts:1:1)';

      errorHandler(err, req, res, jest.fn());

      expect(res.status).toHaveBeenCalledWith(500);
      const body = json.mock.calls[0]?.[0] as { success: boolean; error: Record<string, unknown> };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
      expect(body.error.message).toBe('An unexpected error occurred.');
      expect(JSON.stringify(body)).not.toContain('secret.ts');
      expect(JSON.stringify(body)).not.toContain('stack');
      expect(body.error).not.toHaveProperty('stack');
    } finally {
      process.env.NODE_ENV = previous;
    }
  });

  it('maps AppError to envelope via createApp', async () => {
    const app = healthApp();
    const res = await request(app).get('/__test/error').expect(400);
    expect(res.body).toEqual({
      success: false,
      error: {
        code: 'TEST_ERROR',
        message: 'controlled failure',
        details: { field: 'x' },
      },
    });
    expect(JSON.stringify(res.body)).not.toContain('stack');
  });

  it('includes AppError details on 4xx in production', () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const req = { requestId: 'err-4xx', log: { error: jest.fn() } } as unknown as Request;
      const json = jest.fn();
      const res = { status: jest.fn().mockReturnValue({ json }) } as unknown as Response;
      const err = new AppError('VALIDATION_ERROR', 'Validation failed', 400, {
        email: ['Invalid email'],
      });

      errorHandler(err, req, res, jest.fn());

      expect(res.status).toHaveBeenCalledWith(400);
      const body = json.mock.calls[0]?.[0] as {
        success: boolean;
        error: { code: string; details?: unknown };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.details).toEqual({ email: ['Invalid email'] });
    } finally {
      process.env.NODE_ENV = previous;
    }
  });
});

describe('env parsing', () => {
  it('fails fast when required env is missing', () => {
    expect(() =>
      loadEnv({
        NODE_ENV: 'test',
        PORT: '4000',
      }),
    ).toThrow(/Invalid environment/);
  });

  it('fails fast on whitespace-only required env', () => {
    expect(() =>
      loadEnv({
        NODE_ENV: 'test',
        PORT: '4000',
        DATABASE_URL: '   ',
        REDIS_URL: 'redis://127.0.0.1:6379',
        CORS_ORIGIN: 'http://localhost:3000',
        JWT_ACCESS_SECRET: 'test-jwt-access-secret',
      }),
    ).toThrow(/Invalid environment/);
  });
});
