import { logger } from '../logger.js';

export type EmailMessageType = 'verification' | 'password-reset';

export type EmailMessage = {
  to: string;
  subject: string;
  body: string;
  type: EmailMessageType;
};

export interface EmailProvider {
  send(message: EmailMessage): Promise<void>;
}

/** Mock transport for local/dev/portfolio use: logs mail via structured Pino logger instead of real SMTP. */
export class ConsoleEmailProvider implements EmailProvider {
  async send(message: EmailMessage): Promise<void> {
    logger.info(
      { to: message.to, subject: message.subject, body: message.body, type: message.type },
      'mock email sent',
    );
  }
}
