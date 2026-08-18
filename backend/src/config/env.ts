import { z } from 'zod';

const envBoolean = (defaultValue: boolean) =>
  z.preprocess((value) => {
    if (value === undefined || value === '') {
      return defaultValue;
    }
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'string') {
      const normalized = value.toLowerCase();
      if (normalized === 'true' || normalized === '1') {
        return true;
      }
      if (normalized === 'false' || normalized === '0') {
        return false;
      }
    }
    return value;
  }, z.boolean());

const PLACEHOLDER_SECRET = /change-me/i;
/** Cookie Max-Age is 32-bit ms; keep seconds so maxAge cannot overflow. */
const MAX_REFRESH_TTL_SECONDS = 2_147_483;

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().trim().min(1),
  REDIS_URL: z.string().trim().min(1),
  CORS_ORIGIN: z.string().trim().min(1),
  EMAIL_VERIFICATION_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().max(129600).default(1440),
  PASSWORD_RESET_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().max(1440).default(60),
  ORG_INVITE_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().max(129600).default(10080),
  SMTP_HOST: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().trim().min(1).optional(),
  ),
  SMTP_PORT: z.coerce.number().int().positive().max(65535).default(1025),
  SMTP_SECURE: envBoolean(false),
  SMTP_USER: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().min(1).optional(),
  ),
  SMTP_PASS: z.preprocess(
    (value) => (typeof value === 'string' && value === '' ? undefined : value),
    z.string().optional(),
  ),
  EMAIL_FROM: z.string().trim().min(1).default('noreply@localhost'),
  JWT_ACCESS_SECRET: z.string().trim().min(1),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().max(3600).default(900),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().max(MAX_REFRESH_TTL_SECONDS).default(604800),
  COOKIE_SECURE: envBoolean(false),
});

export type Env = z.infer<typeof envSchema>;

function cookieSecureProvided(source: NodeJS.ProcessEnv): boolean {
  const raw = source.COOKIE_SECURE;
  return raw !== undefined && raw !== '';
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const details = result.error.flatten().fieldErrors;
    throw new Error(`Invalid environment: ${JSON.stringify(details)}`);
  }
  const data = result.data;
  const cookieSecure = cookieSecureProvided(source) ? data.COOKIE_SECURE : data.NODE_ENV === 'production';

  if (data.NODE_ENV === 'production') {
    if (data.JWT_ACCESS_SECRET.length < 32 || PLACEHOLDER_SECRET.test(data.JWT_ACCESS_SECRET)) {
      throw new Error(
        'Invalid environment: JWT_ACCESS_SECRET must be at least 32 characters and must not be a placeholder in production',
      );
    }
    if (!cookieSecure) {
      throw new Error('Invalid environment: COOKIE_SECURE must be true in production');
    }
  }

  return { ...data, COOKIE_SECURE: cookieSecure };
}

export const env = loadEnv();
