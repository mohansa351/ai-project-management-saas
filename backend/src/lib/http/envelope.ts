export type SuccessEnvelope<T> = {
  success: true;
  data: T;
  meta?: Record<string, unknown>;
};

export type ErrorEnvelope = {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

export function success<T>(data: T, meta?: Record<string, unknown>): SuccessEnvelope<T> {
  if (meta === undefined) {
    return { success: true, data };
  }
  return { success: true, data, meta };
}

export function failure(code: string, message: string, details?: unknown): ErrorEnvelope {
  if (details === undefined) {
    return { success: false, error: { code, message } };
  }
  return { success: false, error: { code, message, details } };
}
