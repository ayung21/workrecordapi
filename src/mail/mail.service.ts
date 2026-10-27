import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter | null = null;

  constructor(private readonly config: ConfigService) {
    const host = this.config.get<string>('SMTP_HOST');
    if (host) {
      this.transporter = nodemailer.createTransport({
        host,
        port: this.config.get<number>('SMTP_PORT', 587),
        secure: false,
        connectionTimeout: 15_000,
        greetingTimeout: 15_000,
        auth: {
          user: this.config.get<string>('SMTP_USER'),
          pass: this.config.get<string>('SMTP_PASS'),
        },
      });
    }
  }

  async sendMail(options: {
    to: string;
    subject: string;
    html: string;
    text?: string;
    from?: string;
  }): Promise<void> {
    const { from: fromOverride, ...rest } = options;
    const from =
      fromOverride ??
      this.config.get<string>('SMTP_FROM', 'WorkRecord <noreply@workrecord.id>');
    if (!this.transporter) {
      this.logger.warn(
        `SMTP not configured. Email to ${options.to}: ${options.subject}`,
      );
      this.logger.debug(options.text ?? options.html);
      return;
    }
    await this.transporter.sendMail({ from, ...rest });
  }

  billingFromAddress(): string {
    const explicit = this.config.get<string>('SMTP_BILLING_FROM')?.trim();
    if (explicit) return explicit;

    const defaultFrom = this.config.get<string>(
      'SMTP_FROM',
      'WorkRecord <noreply@workrecord.id>',
    );
    const angle = defaultFrom.match(/<([^>]+)>/);
    if (angle) {
      const email = angle[1].replace(/^noreply@/i, 'billing@');
      const display = defaultFrom.replace(/<[^>]+>/, '').trim();
      const name =
        display && /billing/i.test(display)
          ? display
          : 'WorkRecord Billing';
      return `${name} <${email}>`;
    }
    return 'WorkRecord Billing <billing@workrecord.co.id>';
  }
}
