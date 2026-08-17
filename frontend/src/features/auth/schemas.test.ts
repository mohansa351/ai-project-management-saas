import { describe, expect, it } from 'vitest';

import { changePasswordSchema, registerSchema } from '@/features/auth/schemas';

describe('auth schemas', () => {
  it('rejects mismatched confirm password on register', () => {
    const result = registerSchema.safeParse({
      name: 'Ada',
      email: 'ada@example.com',
      password: 'password1',
      confirmPassword: 'password2',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a new password that matches the current password', () => {
    const result = changePasswordSchema.safeParse({
      currentPassword: 'password1',
      newPassword: 'password1',
      confirmPassword: 'password1',
    });
    expect(result.success).toBe(false);
  });
});
