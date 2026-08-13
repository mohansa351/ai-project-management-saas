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

function resolveApiPath(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  if (normalized === API_BASE || normalized.startsWith(`${API_BASE}/`)) {
    return normalized;
  }
  return `${API_BASE}${normalized}`;
}

function mergeHeaders(init?: HeadersInit): Headers {
  const headers = new Headers(init);
  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json');
  }
  return headers;
}

/**
 * Same-origin fetch helper for Express via Next rewrites.
 * Always uses relative `/api/v1` — never absolute API hosts or NEXT_PUBLIC_* URLs.
 */
export async function apiFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const url = resolveApiPath(path);

  if (!url.startsWith(API_BASE)) {
    throw new Error('apiFetch must use relative /api/v1 paths only');
  }

  return fetch(url, {
    ...init,
    headers: mergeHeaders(init?.headers),
  });
}

export async function apiJson<T>(
  path: string,
  init?: RequestInit,
): Promise<ApiEnvelope<T>> {
  const response = await apiFetch(path, init);
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
