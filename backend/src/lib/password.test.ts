import { describe, expect, it, jest } from '@jest/globals';
import bcrypt from 'bcrypt';
import { DUMMY_PASSWORD_HASH, hashPassword, verifyLoginPassword, verifyPassword } from './password.js';

describe('password hashing', () => {
  it('stores a bcrypt cost-12 hash that is not plaintext and verifies with compare', async () => {
    const plaintext = 'correct-horse-battery';
    const passwordHash = await hashPassword(plaintext);

    expect(passwordHash).not.toBe(plaintext);
    expect(passwordHash).toMatch(/^\$2[aby]\$12\$/);
    await expect(verifyPassword(plaintext, passwordHash)).resolves.toBe(true);
    await expect(verifyPassword('wrong-password', passwordHash)).resolves.toBe(false);
  });

  it('still runs bcrypt for unknown and inactive users and never matches the dummy hash', async () => {
    const compare = jest.spyOn(bcrypt, 'compare');
    await expect(verifyPassword('password1', DUMMY_PASSWORD_HASH)).resolves.toBe(false);
    compare.mockClear();
    await expect(verifyLoginPassword('password1', null)).resolves.toBe(false);
    expect(compare).toHaveBeenCalled();
    expect(compare.mock.calls.some((call) => call[1] === DUMMY_PASSWORD_HASH)).toBe(true);

    compare.mockClear();
    await expect(
      verifyLoginPassword('password1', {
        isActive: false,
        passwordHash: await hashPassword('password1'),
      }),
    ).resolves.toBe(false);
    expect(compare.mock.calls.some((call) => call[1] === DUMMY_PASSWORD_HASH)).toBe(true);

    compare.mockRestore();
    await expect(
      verifyLoginPassword('password1', {
        isActive: true,
        passwordHash: await hashPassword('password1'),
      }),
    ).resolves.toBe(true);
  });
});
