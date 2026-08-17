import { CHANGE_PASSWORD_WRONG_CURRENT_MESSAGE } from '@/features/auth/constants';
import { accessTokenLooksUnexpired } from '@/features/auth/jwt-exp';
import {
  applyAuthPayload,
  logoutSession,
  runWithSessionLock,
} from '@/features/auth/session-client';
import { useSessionStore } from '@/features/auth/session-store';
import type { AccessTokenUserPayload, PublicUser } from '@/features/auth/types';
import { apiJson, type ApiEnvelope } from '@/lib/api/client';

function jsonInit(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

export async function loginRequest(
  email: string,
  password: string,
): Promise<ApiEnvelope<AccessTokenUserPayload>> {
  const envelope = await apiJson<AccessTokenUserPayload>(
    '/auth/login',
    jsonInit({ email, password }),
    { skipAuth: true, recoverSession: 'never' },
  );
  if (envelope.success) {
    await applyAuthPayload(envelope.data);
  }
  return envelope;
}

export async function registerRequest(input: {
  name: string;
  email: string;
  password: string;
}): Promise<ApiEnvelope<{ user: PublicUser }>> {
  return apiJson<{ user: PublicUser }>(
    '/auth/register',
    jsonInit(input),
    { skipAuth: true, recoverSession: 'never' },
  );
}

export async function verifyEmailRequest(
  token: string,
): Promise<ApiEnvelope<{ message: string }>> {
  return apiJson<{ message: string }>(
    '/auth/verify-email',
    jsonInit({ token }),
    { skipAuth: true, recoverSession: 'never' },
  );
}

export async function resendVerificationRequest(
  email: string,
): Promise<ApiEnvelope<{ message: string }>> {
  return apiJson<{ message: string }>(
    '/auth/resend-verification',
    jsonInit({ email }),
    { skipAuth: true, recoverSession: 'never' },
  );
}

export async function forgotPasswordRequest(
  email: string,
): Promise<ApiEnvelope<{ message: string }>> {
  return apiJson<{ message: string }>(
    '/auth/forgot-password',
    jsonInit({ email }),
    { skipAuth: true, recoverSession: 'never' },
  );
}

export async function resetPasswordRequest(
  token: string,
  password: string,
): Promise<ApiEnvelope<{ message: string }>> {
  const envelope = await apiJson<{ message: string }>(
    '/auth/reset-password',
    jsonInit({ token, password }),
    { skipAuth: true, recoverSession: 'never' },
  );
  useSessionStore.getState().clearToUnauthenticated();
  return envelope;
}

export async function changePasswordRequest(input: {
  currentPassword: string;
  newPassword: string;
}): Promise<ApiEnvelope<AccessTokenUserPayload>> {
  return runWithSessionLock(async () => {
    const envelope = await apiJson<AccessTokenUserPayload>(
      '/auth/change-password',
      jsonInit(input),
      { recoverSession: 'if-access-expired' },
    );
    if (envelope.success) {
      await applyAuthPayload(envelope.data);
      return envelope;
    }
    if (
      !envelope.success &&
      envelope.error.code === 'AUTH_UNAUTHORIZED' &&
      accessTokenLooksUnexpired(useSessionStore.getState().accessToken)
    ) {
      return {
        success: false,
        error: {
          code: envelope.error.code,
          message: CHANGE_PASSWORD_WRONG_CURRENT_MESSAGE,
          details: { currentPassword: [CHANGE_PASSWORD_WRONG_CURRENT_MESSAGE] },
        },
      };
    }
    return envelope;
  });
}

export { logoutSession };
