import bcrypt from 'bcrypt';

const BCRYPT_COST = 12;

/** Cost-12 hash of a throwaway string so unknown/inactive logins still run bcrypt.compare. */
export const DUMMY_PASSWORD_HASH =
  '$2b$12$W.zet5NXZRCnbVRD7iSRi.MFII/OBKctW0nVSWqdk7FQCCyLh7kvW';

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  return bcrypt.compare(password, passwordHash);
}

export async function verifyLoginPassword(
  password: string,
  user: { isActive: boolean; passwordHash: string } | null,
): Promise<boolean> {
  const hash = user?.isActive ? user.passwordHash : DUMMY_PASSWORD_HASH;
  try {
    return await verifyPassword(password, hash);
  } catch {
    return false;
  }
}
