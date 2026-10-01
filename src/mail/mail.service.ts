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
  }): Promise<void> {
    const from = this.config.get<string>('SMTP_FROM', 'WorkRecord <noreply@workrecord.id>');
    if (!this.transporter) {
      this.logger.warn(
        `SMTP not configured. Email to ${options.to}: ${options.subject}`,
      );
      this.logger.debug(options.text ?? options.html);
      return;
    }
    await this.transporter.sendMail({ from, ...options });
  }
}
