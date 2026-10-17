import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq, gte } from 'drizzle-orm';
import { ViewDurationUnit } from '../database/enums';
import { DatabaseService } from '../database/database.service';
import { payments, viewAccessGrants } from '../database/schema';
import { MailService } from '../mail/mail.service';
import { generateSecureToken } from '../common/utils/id-generator';
import { hashToken } from '../common/utils/hash';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class ViewAccessService {
  constructor(
    private readonly database: DatabaseService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  private get db() {
    return this.database.db;
  }

  async onPaymentSuccess(paymentId: string) {
    const payment = await this.db.query.payments.findFirst({
      where: eq(payments.id, paymentId),
    });
    if (!payment || payment.type !== 'VIEW_ACCESS' || !payment.metadata) {
      return;
    }

    const meta = payment.metadata as Record<string, unknown>;
    const email = String(meta.email);
    const durationUnit = meta.durationUnit as ViewDurationUnit;
    const durationValue = Number(meta.durationValue);
    const scope = meta.scope as 'SINGLE_EMPLOYEE' | 'ALL_COMPANY';
    const employeeRecordId = meta.employeeRecordId as string | undefined;

    const rawToken = generateSecureToken();
    const endsAt = this.addDuration(new Date(), durationUnit, durationValue);

    await this.db.insert(viewAccessGrants).values({
      tokenHash: hashToken(rawToken),
      email,
      userId: payment.userId,
      paymentId: payment.id,
      scope,
      companyId: payment.companyId!,
      employeeRecordId:
        scope === 'SINGLE_EMPLOYEE' ? employeeRecordId : undefined,
      durationUnit,
      durationValue,
      endsAt,
    });

    const appUrl = this.config.get<string>('APP_URL', 'http://localhost:3000');
    const link = `${appUrl}/view?token=${rawToken}`;

    await this.audit.log({
      action: 'VIEW_ACCESS_GRANTED',
      actorUserId: payment.userId ?? undefined,
      companyId: payment.companyId!,
      entityType: 'ViewAccessGrant',
      entityId: payment.id,
      metadata: { scope, durationUnit, durationValue, email },
    });

    await this.mail.sendMail({
      to: email,
      subject: 'Link akses WorkRecord',
      text: `Akses Anda aktif hingga ${endsAt.toISOString()}. Buka: ${link}`,
      html: `<p>Akses Anda aktif hingga <strong>${endsAt.toISOString()}</strong>.</p><p><a href="${link}">Buka record</a></p>`,
    });
  }

  private addDuration(
    from: Date,
    unit: ViewDurationUnit,
    value: number,
  ): Date {
    const d = new Date(from);
    switch (unit) {
      case 'HOUR':
        d.setHours(d.getHours() + value);
        break;
      case 'DAY':
        d.setDate(d.getDate() + value);
        break;
      case 'MONTH':
        d.setMonth(d.getMonth() + value);
        break;
    }
    return d;
  }

  async resolveToken(token: string) {
    const grant = await this.db.query.viewAccessGrants.findFirst({
      where: eq(viewAccessGrants.tokenHash, hashToken(token)),
    });
    if (!grant || grant.endsAt < new Date()) return null;
    return grant;
  }

  async listGrantsForUser(userId: string) {
    const now = new Date();
    return this.db
      .select()
      .from(viewAccessGrants)
      .where(
        and(eq(viewAccessGrants.userId, userId), gte(viewAccessGrants.endsAt, now)),
      );
  }
}
