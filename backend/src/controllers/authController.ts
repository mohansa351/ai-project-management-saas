import type { Request, Response } from 'express';
import { z } from 'zod';
import { AppError } from '../lib/http/appError.js';
import { success } from '../lib/http/envelope.js';
import type { AuthService } from '../services/authService.js';
import type { EmailVerificationService } from '../services/emailVerificationService.js';

const registerBodySchema = z.object({
  name: z.string().trim().min(1),
  email: z.string().trim().email(),
  password: z
    .string()
    .min(8)
    .refine((value) => Buffer.byteLength(value, 'utf8') <= 72, {
      message: 'Password must be at most 72 bytes',
    }),
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
