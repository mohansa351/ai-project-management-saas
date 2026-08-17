import { describe, expect, it } from '@jest/globals';
import { ConsoleEmailProvider, SmtpEmailProvider, createEmailProvider } from './emailProvider.js';

describe('createEmailProvider', () => {
  it('uses the console fallback when SMTP is not configured', () => {
    expect(createEmailProvider()).toBeInstanceOf(ConsoleEmailProvider);
    expect(createEmailProvider(undefined)).toBeInstanceOf(ConsoleEmailProvider);
  });

  it('uses SMTP when a host is provided, independent of Mailpit', () => {
    const provider = createEmailProvider({
      host: 'smtp.example.com',
      port: 587,
      secure: true,
      from: 'noreply@example.com',
      user: 'apm',
      pass: 'secret',
    });
    expect(provider).toBeInstanceOf(SmtpEmailProvider);
  });
});
