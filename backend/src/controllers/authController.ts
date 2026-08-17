import type { Request, Response } from 'express';
import { z } from 'zod';
import { AppError } from '../lib/http/appError.js';
import { success } from '../lib/http/envelope.js';
import {
  REFRESH_COOKIE_NAME,
  clearRefreshCookieOptions,
  refreshCookieOptions,
} from '../lib/http/refreshCookie.js';
import type { AuthService } from '../services/authService.js';
import type { EmailVerificationService } from '../services/emailVerificationService.js';

const passwordSchema = z
  .string()
  .min(8)
  .refine((value) => Buffer.byteLength(value, 'utf8') <= 72, {
    message: 'Password must be at most 72 bytes',
  });

const registerBodySchema = z.object({
  name: z.string().trim().min(1),
  email: z.string().trim().email(),
  password: passwordSchema,
});

const loginBodySchema = z.object({
  email: z.string().trim().email(),
  password: passwordSchema,
});

const verifyEmailBodySchema = z.object({
  token: z.string().trim().min(1),
});

const resendVerificationBodySchema = z.object({
  email: z.string().trim().email(),
});

const GENERIC_RESEND_MESSAGE =
  'If an account with that email exists and needs verification, a new link has been sent.';

export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly emailVerificationService: EmailVerificationService,
  ) {}

  register = async (req: Request, res: Response): Promise<void> => {
    const parsed = registerBodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Validation failed', 400, parsed.error.flatten().fieldErrors);
    }
    const user = await this.authService.register(parsed.data);
    res.status(201).json(success({ user }));
  };

  login = async (req: Request, res: Response): Promise<void> => {
    const parsed = loginBodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Validation failed', 400, parsed.error.flatten().fieldErrors);
    }
    const userAgentHeader = req.get('user-agent');
    const result = await this.authService.login({
      ...parsed.data,
      userAgent: userAgentHeader ? userAgentHeader.slice(0, 512) : undefined,
    });
    res.cookie(REFRESH_COOKIE_NAME, result.refreshToken, refreshCookieOptions());
    res.status(200).json(success({ accessToken: result.accessToken, user: result.user }));
  };

  logout = async (req: Request, res: Response): Promise<void> => {
    const cookie = req.cookies?.[REFRESH_COOKIE_NAME];
    const raw = Array.isArray(cookie) ? cookie[0] : cookie;
    await this.authService.logout(typeof raw === 'string' ? raw : undefined);
    res.clearCookie(REFRESH_COOKIE_NAME, clearRefreshCookieOptions());
    res.status(200).json(success({ message: 'Logged out.' }));
  };

  verifyEmail = async (req: Request, res: Response): Promise<void> => {
    const parsed = verifyEmailBodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Validation failed', 400, parsed.error.flatten().fieldErrors);
    }
    await this.emailVerificationService.verify(parsed.data.token);
    res.status(200).json(success({ message: 'Email verified.' }));
  };

  resendVerification = async (req: Request, res: Response): Promise<void> => {
    const parsed = resendVerificationBodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Validation failed', 400, parsed.error.flatten().fieldErrors);
    }
    await this.emailVerificationService.resend(parsed.data.email);
    res.status(200).json(success({ message: GENERIC_RESEND_MESSAGE }));
  };
}
