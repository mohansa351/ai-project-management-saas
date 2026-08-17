import type { ApiErrorEnvelope } from '@/lib/api/client';

export function apiErrorFieldMessages(
  details: unknown,
): Record<string, string> {
  if (!details || typeof details !== 'object') {
    return {};
  }
  const mapped: Record<string, string> = {};
  for (const [key, value] of Object.entries(details as Record<string, unknown>)) {
    if (Array.isArray(value) && typeof value[0] === 'string') {
      mapped[key] = value[0];
    } else if (typeof value === 'string') {
      mapped[key] = value;
    }
  }
  return mapped;
}

export function isApiError(
  envelope: { success: boolean } | ApiErrorEnvelope,
): envelope is ApiErrorEnvelope {
  return envelope.success === false;
}
