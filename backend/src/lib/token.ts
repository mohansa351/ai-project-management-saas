import { createHash, randomBytes } from 'node:crypto';

/** Raw single-use token to hand to a caller (e.g. embed in a mail link). Never persisted as-is. */
export function generateToken(): string {
  return randomBytes(32).toString('hex');
}

/** SHA-256 hash of a raw token, safe to persist and compare against. */
export function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}
