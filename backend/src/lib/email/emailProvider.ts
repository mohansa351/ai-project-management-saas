import nodemailer from 'nodemailer';
import { logger } from '../logger.js';

export type EmailMessageType = 'verification' | 'password-reset' | 'organization_invite';

export type EmailMessage = {
  to: string;
  subject: string;
  body: string;
  html?: string;
  type: EmailMessageType;
};

export interface EmailProvider {
  send(message: EmailMessage): Promise<void>;
}

export type SmtpEmailConfig = {
  host: string;
  port: number;
  secure: boolean;
  from: string;
  user?: string;
  pass?: string;
};

/** Fallback transport when SMTP is unset (tests / no mail server): structured Pino log. */
export class ConsoleEmailProvider implements EmailProvider {
  async send(message: EmailMessage): Promise<void> {
    logger.info(
      { to: message.to, subject: message.subject, body: message.body, type: message.type },
      'email sent (console)',
    );
  }
}

/** SMTP transport. Host/port/credentials are env-driven so Mailpit and production are independent. */
export class SmtpEmailProvider implements EmailProvider {
  private readonly from: string;
  private readonly transporter: nodemailer.Transporter;

  constructor(config: SmtpEmailConfig) {
    this.from = config.from;
    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: config.user ? { user: config.user, pass: config.pass ?? '' } : undefined,
    });
  }

  async send(message: EmailMessage): Promise<void> {
    await this.transporter.sendMail({
      from: this.from,
      to: message.to,
      subject: message.subject,
      text: message.body,
      html: message.html,
    });
  }
}

/** Use SMTP when a host is configured; otherwise console fallback. */
export function createEmailProvider(smtp?: SmtpEmailConfig): EmailProvider {
  if (!smtp?.host) {
    return new ConsoleEmailProvider();
  }
  return new SmtpEmailProvider(smtp);
}
