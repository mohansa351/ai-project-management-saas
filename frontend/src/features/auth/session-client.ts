import { COOKIE_ONLY_OR_PUBLIC_AUTH_SUFFIXES } from '@/features/auth/constants';
import { accessTokenLooksUnexpired } from '@/features/auth/jwt-exp';
import { useSessionStore } from '@/features/auth/session-store';
import type { AccessTokenUserPayload } from '@/features/auth/types';
import {
  apiFetch,
  apiJson,
  configureApiFetchAuth,
  resolveApiPath,
  type ApiEnvelope,
  type ApiFetchOptions,
} from '@/lib/api/client';

let refreshInFlight: Promise<boolean> | null = null;
let exclusive: Promise<unknown> = Promise.resolve();

export function isCookieOnlyOrPublicAuthPath(resolvedPath: string): boolean {
  const pathname = resolvedPath.split('?')[0] ?? resolvedPath;
  return COOKIE_ONLY_OR_PUBLIC_AUTH_SUFFIXES.some((suffix) =>
    pathname.endsWith(suffix),
  );
}

function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
  const next = exclusive.then(fn, fn);
  exclusive = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

async function waitForRefreshInFlight(): Promise<void> {
  if (refreshInFlight) {
    await refreshInFlight.catch(() => false);
  }
}

function parseAccessUser(envelope: ApiEnvelope<AccessTokenUserPayload>): AccessTokenUserPayload | null {
  if (!envelope.success) {
    return null;
  }
  const { accessToken, user } = envelope.data;
  if (typeof accessToken !== 'string' || !accessToken || !user || typeof user !== 'object') {
    return null;
  }
  return { accessToken, user };
}

async function postRefresh(): Promise<AccessTokenUserPayload | null> {
  const envelope = await apiJson<AccessTokenUserPayload>(
    '/auth/refresh',
    { method: 'POST' },
    { skipAuth: true, recoverSession: 'never' },
  );
  return parseAccessUser(envelope);
}

function commitIfCurrent(
  generation: number,
  payload: AccessTokenUserPayload,
): boolean {
  const state = useSessionStore.getState();
  if (state.authGeneration !== generation || state.status === 'logging-out') {
    return false;
  }
  state.applySession(payload.accessToken, payload.user);
  return true;
}

async function refreshAttemptPair(generation: number): Promise<boolean> {
  const first = await postRefresh();
  if (first) {
    return commitIfCurrent(generation, first);
  }
  // Overlap 401 does not Clear-Cookie; retry once with whatever the browser now sends.
  const second = await postRefresh();
  if (second) {
    return commitIfCurrent(generation, second);
  }
  return false;
}

/**
 * Single-flight cookie refresh. At most one overlap retry. Never reads refresh_token.
 * Interceptor failures do not POST /logout (would Clear-Cookie a winner T2).
 */
export function refreshSession(): Promise<boolean> {
  if (refreshInFlight) {
    return refreshInFlight;
  }
  const generation = useSessionStore.getState().authGeneration;
  refreshInFlight = (async () => {
    const ok = await refreshAttemptPair(generation);
    if (!ok) {
      const state = useSessionStore.getState();
      if (state.authGeneration === generation && state.status !== 'logging-out') {
        state.clearToUnauthenticated();
      }
    }
    return ok;
  })().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

export async function bootstrapSession(): Promise<boolean> {
  const { status, setRestoring } = useSessionStore.getState();
  if (status === 'authenticated') {
    return true;
  }
  if (status === 'unauthenticated') {
    return false;
  }
  setRestoring();
  return refreshSession();
}

export async function logoutSession(): Promise<void> {
  await runExclusive(async () => {
    await waitForRefreshInFlight();
    useSessionStore.getState().beginLogout();
    try {
      await apiFetch(
        '/auth/logout',
        { method: 'POST' },
        { skipAuth: true, recoverSession: 'never' },
      );
    } finally {
      useSessionStore.getState().clearToUnauthenticated();
    }
  });
}

export async function recoverUnauthorized(args: {
  path: string;
  init: RequestInit | undefined;
  options: ApiFetchOptions;
  response: Response;
}): Promise<Response | null> {
  const resolved = resolveApiPath(args.path);
  const mode = args.options.recoverSession ?? (isCookieOnlyOrPublicAuthPath(resolved) ? 'never' : 'always');

  if (args.options.alreadyRecovered || mode === 'never') {
    return null;
  }
  if (mode === 'if-access-expired') {
    const token = useSessionStore.getState().accessToken;
    if (accessTokenLooksUnexpired(token)) {
      return null;
    }
  }

  const generation = useSessionStore.getState().authGeneration;
  const ok = await refreshSession();
  if (!ok) {
    return null;
  }
  if (useSessionStore.getState().authGeneration !== generation) {
    return null;
  }

  return apiFetch(args.path, args.init, {
    ...args.options,
    alreadyRecovered: true,
    recoverSession: 'never',
  });
}

export async function applyAuthPayload(payload: AccessTokenUserPayload): Promise<void> {
  useSessionStore.getState().applySession(payload.accessToken, payload.user);
}

export async function runWithSessionLock<T>(fn: () => Promise<T>): Promise<T> {
  return runExclusive(async () => {
    await waitForRefreshInFlight();
    return fn();
  });
}

export function resetAuthRuntimeForTests(): void {
  refreshInFlight = null;
  exclusive = Promise.resolve();
  useSessionStore.getState().resetForTests();
}

configureApiFetchAuth({
  getAccessToken: () => useSessionStore.getState().accessToken,
  getOrganizationId: () => useSessionStore.getState().currentOrganizationId,
  shouldAttachBearer: (resolvedPath) => !isCookieOnlyOrPublicAuthPath(resolvedPath),
  recoverUnauthorized,
});
