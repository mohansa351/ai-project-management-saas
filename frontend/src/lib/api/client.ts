const API_BASE = '/api/v1';

export type ApiSuccessEnvelope<T> = {
  success: true;
  data: T;
  meta?: Record<string, unknown>;
};

export type ApiErrorEnvelope = {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

export type ApiEnvelope<T> = ApiSuccessEnvelope<T> | ApiErrorEnvelope;

export type RecoverSession = 'always' | 'never' | 'if-access-expired';

export type ApiFetchOptions = {
  skipAuth?: boolean;
  recoverSession?: RecoverSession;
  alreadyRecovered?: boolean;
};

export type ApiFetchAuthHooks = {
  getAccessToken: () => string | null;
  getOrganizationId?: () => string | null;
  shouldAttachBearer: (resolvedPath: string) => boolean;
  recoverUnauthorized: (args: {
    path: string;
    init: RequestInit | undefined;
    options: ApiFetchOptions;
    response: Response;
  }) => Promise<Response | null>;
};

let authHooks: ApiFetchAuthHooks | null = null;

export function configureApiFetchAuth(hooks: ApiFetchAuthHooks | null): void {
  authHooks = hooks;
}

/**
 * Build a same-origin `/api/v1…` path and reject traversal/escape outside that prefix.
 */
export function resolveApiPath(path: string): string {
  const input = path.trim();
  if (!input) {
    throw new Error('apiFetch path must be a non-empty relative path');
  }
  if (/^[a-zA-Z][a-zA-Z+\-.]*:/.test(input)) {
    throw new Error('apiFetch must use relative /api/v1 paths only');
  }

  const withLeadingSlash = input.startsWith('/') ? input : `/${input}`;
  const candidate =
    withLeadingSlash === API_BASE || withLeadingSlash.startsWith(`${API_BASE}/`)
      ? withLeadingSlash
      : `${API_BASE}${withLeadingSlash}`;

  // Collapse `.` / `..` and decode percent-encoding the same way the browser will.
  const resolved = new URL(candidate, 'http://apm.invalid');
  const { pathname, search } = resolved;

  if (pathname !== API_BASE && !pathname.startsWith(`${API_BASE}/`)) {
    throw new Error('apiFetch path escapes /api/v1');
  }

  for (const segment of pathname.split('/')) {
    if (segment === '..' || segment === '.') {
      throw new Error('apiFetch path escapes /api/v1');
    }
  }

  return `${pathname}${search}`;
}

function mergeHeaders(init?: HeadersInit): Headers {
  const headers = new Headers(init);
  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json');
  }
  return headers;
}

function attachAuthorization(
  headers: Headers,
  resolvedPath: string,
  options: ApiFetchOptions | undefined,
): void {
  headers.delete('Authorization');
  headers.delete('X-Organization-Id');
  if (options?.skipAuth || !authHooks) {
    return;
  }
  if (!authHooks.shouldAttachBearer(resolvedPath)) {
    return;
  }
  const token = authHooks.getAccessToken();
  if (!token) {
    return;
  }
  headers.set('Authorization', `Bearer ${token}`);
  const organizationId = authHooks.getOrganizationId?.()?.trim();
  if (organizationId) {
    headers.set('X-Organization-Id', organizationId);
  }
}

/**
 * Same-origin fetch helper for Express via Next rewrites.
 * Always uses relative `/api/v1` — never absolute API hosts or NEXT_PUBLIC_* URLs.
 * Always sends cookies (`credentials: 'include'`). Callers cannot opt out.
 */
export async function apiFetch(
  path: string,
  init?: RequestInit,
  options?: ApiFetchOptions,
): Promise<Response> {
  const url = resolveApiPath(path);
  const headers = mergeHeaders(init?.headers);
  attachAuthorization(headers, url, options);

  const response = await fetch(url, {
    ...init,
    credentials: 'include',
    headers,
  });

  if (response.status !== 401 || options?.alreadyRecovered || !authHooks) {
    return response;
  }

  const recovered = await authHooks.recoverUnauthorized({
    path,
    init,
    options: options ?? {},
    response,
  });
  return recovered ?? response;
}

export async function apiJson<T>(
  path: string,
  init?: RequestInit,
  options?: ApiFetchOptions,
): Promise<ApiEnvelope<T>> {
  const response = await apiFetch(path, init, options);
  const text = await response.text();

  if (!text.trim()) {
    throw new Error(
      `Expected JSON envelope from ${resolveApiPath(path)}, received empty body`,
    );
  }

  try {
    return JSON.parse(text) as ApiEnvelope<T>;
  } catch {
    throw new Error(
      `Expected JSON envelope from ${resolveApiPath(path)}, received non-JSON response`,
    );
  }
}

export function getApiBasePath(): string {
  return API_BASE;
}
