/**
 * Untrusted JWT payload `exp` read for session-recovery heuristics only.
 * Does not verify the signature. Not a security boundary.
 */
export function accessTokenLooksUnexpired(
  token: string | null | undefined,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): boolean {
  if (!token) {
    return false;
  }
  const parts = token.split('.');
  if (parts.length < 2 || !parts[1]) {
    return false;
  }
  try {
    const json = JSON.parse(decodeBase64Url(parts[1])) as { exp?: unknown };
    return typeof json.exp === 'number' && json.exp > nowSeconds;
  } catch {
    return false;
  }
}

function decodeBase64Url(segment: string): string {
  const padded = segment.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
  if (typeof globalThis.atob === 'function') {
    return globalThis.atob(padded + pad);
  }
  return Buffer.from(padded + pad, 'base64').toString('utf8');
}
