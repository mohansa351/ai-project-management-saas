export const PRODUCT_NAME = 'AI Project Management SaaS';

export const AUTH_SESSION_UNAUTHORIZED_MESSAGE = 'Authentication required.';
export const LOGIN_INVALID_MESSAGE = 'Invalid email or password.';
export const GENERIC_RESEND_MESSAGE =
  'If an account with that email exists and needs verification, a new link has been sent.';
export const GENERIC_FORGOT_MESSAGE =
  'If an account with that email exists, a reset link has been sent.';
export const RESET_SUCCESS_MESSAGE =
  'Password has been reset. Sign in with your new password.';
export const CHANGE_PASSWORD_WRONG_CURRENT_MESSAGE =
  'Current password is incorrect.';

export const DEFAULT_AFTER_LOGIN = '/dashboard';

/** Paths (after resolveApiPath) that must never send Bearer and never run 401 recovery. */
export const COOKIE_ONLY_OR_PUBLIC_AUTH_SUFFIXES = [
  '/auth/register',
  '/auth/login',
  '/auth/logout',
  '/auth/refresh',
  '/auth/verify-email',
  '/auth/resend-verification',
  '/auth/forgot-password',
  '/auth/reset-password',
] as const;
