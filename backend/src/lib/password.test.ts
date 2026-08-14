import { describe, expect, it } from '@jest/globals';
import { hashPassword, verifyPassword } from './password.js';

describe('password hashing', () => {
  it('stores a bcrypt cost-12 hash that is not plaintext and verifies with compare', async () => {
    const plaintext = 'correct-horse-battery';
    const passwordHash = await hashPassword(plaintext);

    expect(passwordHash).not.toBe(plaintext);
    expect(passwordHash).toMatch(/^\$2[aby]\$12\$/);
    await expect(verifyPassword(plaintext, passwordHash)).resolves.toBe(true);
    await expect(verifyPassword('wrong-password', passwordHash)).resolves.toBe(false);
  });
});
