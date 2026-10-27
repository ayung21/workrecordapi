import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq, isNull } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import { companies, payments, users } from '../database/schema';
import { MailService } from './mail.service';

const BILLING_PAYMENT_TYPES = ['DISPUTE', 'BLACKLIST', 'AD'] as const;
type BillingPaymentType = (typeof BILLING_PAYMENT_TYPES)[number];

const KIND_LABEL: Record<
  BillingPaymentType,
  { userNoun: string; adminNoun: string }
> = {
  DISPUTE: {
    userNoun: 'sanggahan pekerja',
    adminNoun: 'sanggahan pekerja',
  },
  BLACKLIST: {
    userNoun: 'sanggahan / blacklist karyawan',
    adminNoun: 'sanggahan karyawan (blacklist)',
  },
  AD: {
    userNoun: 'iklan',
    adminNoun: 'iklan',
  },
};

function formatIdr(amount: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(amount);
}

type ManualTransferInfo = {
  bankName: string;
  accountNumber: string;
  accountHolder: string;
  label?: string | null;
  transferAmount: number;
  baseAmount: number;
  uniqueCode: number;
  note?: string;
};

@Injectable()
export class BillingMailService {
  private readonly logger = new Logger(BillingMailService.name);

  constructor(
    private readonly mail: MailService,
    private readonly config: ConfigService,
    private readonly database: DatabaseService,
  ) {}

  private get db() {
    return this.database.db;
  }

  isBillingPaymentType(type: string): type is BillingPaymentType {
    return (BILLING_PAYMENT_TYPES as readonly string[]).includes(type);
  }

  private async billingAdminEmails(): Promise<string[]> {
    const override = this.config.get<string>('BILLING_ADMIN_EMAILS')?.trim();
    if (override) {
      return [...new Set(override.split(',').map((e) => e.trim()).filter(Boolean))];
    }
    const owners = await this.db.query.users.findMany({
      where: and(eq(users.isActive, true), isNull(users.companyId)),
      columns: { email: true },
    });
    return [...new Set(owners.map((u) => u.email).filter(Boolean))];
  }

  private async companyName(companyId: string | null): Promise<string | null> {
    if (!companyId) return null;
    const row = await this.db.query.companies.findFirst({
      where: eq(companies.id, companyId),
      columns: { name: true },
    });
    return row?.name ?? null;
  }

  private manualTransferHtml(info: ManualTransferInfo): string {
    const label = info.label ? `<p>Rekening: ${info.label}</p>` : '';
    return `
      <p><strong>Transfer manual</strong></p>
      ${label}
      <p>Bank: ${info.bankName}<br/>
      No. rekening: ${info.accountNumber}<br/>
      Atas nama: ${info.accountHolder}</p>
      <p><strong>Nominal transfer (wajib tepat):</strong> ${formatIdr(info.transferAmount)}</p>
      <p>Terdiri dari biaya ${formatIdr(info.baseAmount)} + kode unik ${info.uniqueCode}.</p>
      <p>${info.note ?? 'Konfirmasi oleh admin WorkRecord setelah dana masuk.'}</p>
    `;
  }

  private async safeSend(task: () => Promise<void>, context: string): Promise<void> {
    try {
      await task();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Gagal kirim email billing (${context}): ${message}`);
    }
  }

  async notifyCheckoutRequired(input: {
    payment: typeof payments.$inferSelect;
    customerEmail: string;
    customerName: string;
    itemName: string;
    amount: number;
    manualTransfer?: ManualTransferInfo;
  }): Promise<void> {
    const { payment } = input;
    if (!this.isBillingPaymentType(payment.type)) return;

    const kind = KIND_LABEL[payment.type];
    const company = await this.companyName(payment.companyId);
    const companyLine = company
      ? `<p>Perusahaan: <strong>${company}</strong></p>`
      : '';
    const amountStr = formatIdr(input.amount);
    const from = this.mail.billingFromAddress();
    const appUrl = this.config.get<string>('APP_URL', 'http://localhost:3008');
    const transferBlock = input.manualTransfer
      ? this.manualTransferHtml(input.manualTransfer)
      : `<p>Selesaikan pembayaran melalui portal WorkRecord.</p>`;

    const userHtml = `
      <p>Halo ${input.customerName},</p>
      <p>Anda harus membayar <strong>${amountStr}</strong> untuk pengajuan <strong>${kind.userNoun}</strong> (${input.itemName}).</p>
      ${companyLine}
      <p>ID pembayaran: <code>${payment.id}</code></p>
      ${transferBlock}
      <p>Setelah transfer, admin WorkRecord akan memverifikasi pembayaran. Anda akan menerima email konfirmasi ketika pembayaran disetujui.</p>
      <p><a href="${appUrl}">Buka WorkRecord</a></p>
    `;

    const userText = `Anda harus membayar ${amountStr} untuk ${kind.userNoun}. ID pembayaran: ${payment.id}.`;

    await this.safeSend(
      () =>
        this.mail.sendMail({
          from,
          to: input.customerEmail,
          subject: `Anda harus membayar — ${kind.userNoun} WorkRecord (${amountStr})`,
          html: userHtml,
          text: userText,
        }),
      'checkout-user',
    );

    const admins = await this.billingAdminEmails();
    if (admins.length === 0) {
      this.logger.warn('Tidak ada email admin billing (BILLING_ADMIN_EMAILS / platform owner).');
      return;
    }

    const adminHtml = `
      <p>Ada pengguna yang mengajukan <strong>${kind.adminNoun}</strong> dan menunggu pembayaran.</p>
      ${companyLine}
      <p>Pengaju: <strong>${input.customerName}</strong> (${input.customerEmail})</p>
      <p>Nominal: <strong>${amountStr}</strong></p>
      <p>ID pembayaran: <code>${payment.id}</code></p>
      <p>Item: ${input.itemName}</p>
      <p>Konfirmasi di panel admin setelah transfer masuk.</p>
    `;

    for (const to of admins) {
      await this.safeSend(
        () =>
          this.mail.sendMail({
            from,
            to,
            subject: `Pengajuan ${kind.adminNoun} — menunggu pembayaran (${amountStr})`,
            html: adminHtml,
            text: `Pengajuan ${kind.adminNoun} dari ${input.customerEmail}, nominal ${amountStr}, payment ${payment.id}.`,
          }),
        'checkout-admin',
      );
    }
  }

  async notifyManualPaymentApproved(
    payment: typeof payments.$inferSelect,
  ): Promise<void> {
    if (!this.isBillingPaymentType(payment.type)) return;
    if (payment.status !== 'PAID') return;

    const meta = (payment.metadata ?? {}) as { email?: string };
    let customerEmail = meta.email?.trim();
    let customerName = customerEmail ?? 'Pengguna';

    if (payment.userId) {
      const user = await this.db.query.users.findFirst({
        where: eq(users.id, payment.userId),
      });
      if (user) {
        customerEmail = customerEmail ?? user.email;
        customerName = user.fullName?.trim() || user.publicLoginId || customerName;
      }
    }
    if (!customerEmail) {
      this.logger.warn(
        `Tidak ada email penerima untuk konfirmasi pembayaran ${payment.id}`,
      );
      return;
    }

    const kind = KIND_LABEL[payment.type];
    const amountStr = formatIdr(Number(payment.amount));
    const company = await this.companyName(payment.companyId);
    const companyLine = company ? `<p>Perusahaan: <strong>${company}</strong></p>` : '';
    const from = this.mail.billingFromAddress();
    const appUrl = this.config.get<string>('APP_URL', 'http://localhost:3008');

    const html = `
      <p>Halo ${customerName},</p>
      <p>Pembayaran Anda sebesar <strong>${amountStr}</strong> untuk <strong>${kind.userNoun}</strong> telah <strong>dikonfirmasi</strong> oleh admin WorkRecord.</p>
      ${companyLine}
      <p>ID pembayaran: <code>${payment.id}</code></p>
      <p>Proses dapat dilanjutkan di portal (misalnya melengkapi sanggahan atau aktivasi iklan).</p>
      <p><a href="${appUrl}">Buka WorkRecord</a></p>
    `;

    await this.safeSend(
      () =>
        this.mail.sendMail({
          from,
          to: customerEmail,
          subject: `Pembayaran dikonfirmasi — ${kind.userNoun} WorkRecord`,
          html,
          text: `Pembayaran ${amountStr} untuk ${kind.userNoun} telah dikonfirmasi. ID: ${payment.id}.`,
        }),
      'approved-user',
    );
  }
}
