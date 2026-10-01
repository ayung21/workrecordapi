import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PaymentType,
  ViewAccessScope,
  ViewDurationUnit,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { generateSecureToken } from '../common/utils/id-generator';
import { hashToken } from '../common/utils/hash';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class ViewAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  async onPaymentSuccess(paymentId: string) {
    const payment = await this.prisma.payment.findUniqueOrThrow({
      where: { id: paymentId },
    });
    if (payment.type !== PaymentType.VIEW_ACCESS || !payment.metadata) return;

    const meta = payment.metadata as Record<string, unknown>;
    const email = String(meta.email);
    const durationUnit = meta.durationUnit as ViewDurationUnit;
    const durationValue = Number(meta.durationValue);
    const scope = meta.scope as ViewAccessScope;
    const employeeRecordId = meta.employeeRecordId as string | undefined;

    const rawToken = generateSecureToken();
    const endsAt = this.addDuration(new Date(), durationUnit, durationValue);

    await this.prisma.viewAccessGrant.create({
      data: {
        tokenHash: hashToken(rawToken),
        email,
        userId: payment.userId,
        paymentId: payment.id,
        scope,
        companyId: payment.companyId!,
        employeeRecordId:
          scope === ViewAccessScope.SINGLE_EMPLOYEE
            ? employeeRecordId
            : undefined,
        durationUnit,
        durationValue,
        endsAt,
      },
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
      case ViewDurationUnit.HOUR:
        d.setHours(d.getHours() + value);
        break;
      case ViewDurationUnit.DAY:
        d.setDate(d.getDate() + value);
        break;
      case ViewDurationUnit.MONTH:
        d.setMonth(d.getMonth() + value);
        break;
    }
    return d;
  }

  async resolveToken(token: string) {
    const grant = await this.prisma.viewAccessGrant.findUnique({
      where: { tokenHash: hashToken(token) },
    });
    if (!grant || grant.endsAt < new Date()) return null;
    return grant;
  }

  async listGrantsForUser(userId: string) {
    const now = new Date();
    return this.prisma.viewAccessGrant.findMany({
      where: { userId, endsAt: { gte: now } },
    });
  }
}
