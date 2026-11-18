import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq, and, desc } from 'drizzle-orm';
import { ViewDurationUnit } from '../database/enums';
import { DatabaseService } from '../database/database.service';
import { payments, users, voucherRedemptions } from '../database/schema';
import { PaymentGatewayFactory } from './payment-gateway.factory';
import { PaymentLiveHub } from './payment-live.hub';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { ViewAccessService } from '../view-access/view-access.service';
import { v4 as uuidv4 } from 'uuid';
import { AuditService } from '../audit/audit.service';
import { BlacklistsService } from '../blacklists/blacklists.service';
import { VouchersService } from '../vouchers/vouchers.service';
import { AdsService } from '../ads/ads.service';
import {
  ManualPaymentBankAccount,
  PricingService,
} from '../pricing/pricing.service';
import {
  allocateManualUniqueCode,
  transferAmountIdr,
} from './manual-transfer.util';
import { BillingMailService } from '../mail/billing-mail.service';

const MANUAL_OWNER_APPROVE_TYPES = ['AD', 'BLACKLIST', 'DISPUTE'] as const;

@Injectable()
export class PaymentsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly gatewayFactory: PaymentGatewayFactory,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    @Inject(forwardRef(() => SubscriptionsService))
    private readonly subscriptions: SubscriptionsService,
    @Inject(forwardRef(() => ViewAccessService))
    private readonly viewAccess: ViewAccessService,
    @Inject(forwardRef(() => BlacklistsService))
    private readonly blacklists: BlacklistsService,
    private readonly vouchers: VouchersService,
    private readonly pricing: PricingService,
    @Inject(forwardRef(() => AdsService))
    private readonly ads: AdsService,
    private readonly billingMail: BillingMailService,
    private readonly live: PaymentLiveHub,
  ) {}

  private get db() {
    return this.database.db;
  }

  private gateway() {
    return this.gatewayFactory.getGateway();
  }

  async getManualBankInstructions() {
    const gateway = this.gatewayFactory.gatewayName();
    if (gateway !== 'manual') {
      return { gateway, accounts: [] as ManualPaymentBankAccount[] };
    }
    const accounts = await this.pricing.getManualPaymentBanks();
    return { gateway, accounts };
  }

  private buildManualTransferPayload(
    account: ManualPaymentBankAccount,
    transferAmount: number,
    baseAmount: number,
    uniqueCode: number,
  ) {
    return {
      bankAccountId: account.id,
      bankName: account.bankName,
      accountNumber: account.accountNumber,
      accountHolder: account.accountHolder,
      label: account.label,
      baseAmount,
      uniqueCode,
      transferAmount,
      note:
        'Transfer tepat sesuai nominal (termasuk 3 digit unik di belakang). Konfirmasi oleh admin WorkRecord setelah dana masuk.',
    };
  }

  async finalizeCheckout(
    payment: typeof payments.$inferSelect,
    input: {
      orderId: string;
      customerEmail: string;
      customerName: string;
      itemName: string;
      baseAmount?: number;
      manualBankAccountId?: string;
    },
  ) {
    let amount = Number(payment.amount);
    const baseAmount = input.baseAmount ?? amount;
    let meta = (payment.metadata ?? {}) as Record<string, unknown>;
    let current = payment;
    let bankAccount: ManualPaymentBankAccount | undefined;

    if (this.gatewayFactory.isManual()) {
      bankAccount = await this.pricing.resolveManualPaymentBank(
        input.manualBankAccountId,
      );
      const uniqueCode = await allocateManualUniqueCode(this.database);
      amount = transferAmountIdr(baseAmount, uniqueCode);
      meta = {
        ...meta,
        baseAmount,
        uniqueCode,
        manualTransfer: true,
        manualBankAccountId: bankAccount.id,
        manualBankSnapshot: {
          bankName: bankAccount.bankName,
          accountNumber: bankAccount.accountNumber,
          accountHolder: bankAccount.accountHolder,
          label: bankAccount.label,
        },
      };
      const [updated] = await this.db
        .update(payments)
        .set({
          amount: String(amount),
          metadata: meta,
          updatedAt: new Date(),
        })
        .where(eq(payments.id, payment.id))
        .returning();
      current = updated;
    }

    const result = await this.gateway().createPayment({
      orderId: input.orderId,
      amount,
      customerEmail: input.customerEmail,
      customerName: input.customerName,
      itemName: input.itemName,
    });

    if (result.contractId || result.qrUrl || result.qrContent) {
      meta = {
        ...meta,
        winpay: {
          contractId: result.contractId ?? null,
          qrUrl: result.qrUrl ?? null,
          qrContent: result.qrContent ?? null,
          expiredAt: result.expiredAt ?? null,
        },
      };
      await this.db
        .update(payments)
        .set({
          metadata: meta,
          gatewayTxnId: result.contractId,
          updatedAt: new Date(),
        })
        .where(eq(payments.id, current.id));
    }

    const manualTransfer =
      this.gatewayFactory.isManual() && bankAccount
        ? this.buildManualTransferPayload(
            bankAccount,
            amount,
            baseAmount,
            meta.uniqueCode as number,
          )
        : undefined;

    if (
      !this.gatewayFactory.isManual() &&
      !result.qrUrl &&
      !result.qrContent &&
      !result.redirectUrl
    ) {
      throw new BadRequestException(
        'Gateway pembayaran tidak mengembalikan QRIS atau tautan bayar. Coba lagi beberapa saat.',
      );
    }

    void this.billingMail.notifyCheckoutRequired({
      payment: current,
      customerEmail: input.customerEmail,
      customerName: input.customerName,
      itemName: input.itemName,
      amount,
      manualTransfer,
    });

    const catalogAmountRaw = meta.originalAmount;
    const catalogAmount =
      typeof catalogAmountRaw === 'number'
        ? catalogAmountRaw
        : catalogAmountRaw != null
          ? Number(catalogAmountRaw)
          : baseAmount;
    const discountedBase =
      typeof meta.discountedAmount === 'number'
        ? meta.discountedAmount
        : baseAmount;

    return {
      paymentId: current.id,
      amount,
      originalAmount: catalogAmount,
      discountedAmount: discountedBase,
      discountAmount: Math.max(0, catalogAmount - discountedBase),
      ...result,
      qris:
        result.qrUrl || result.qrContent
          ? {
              paymentId: current.id,
              qrUrl: result.qrUrl ?? null,
              qrContent: result.qrContent ?? null,
              contractId: result.contractId ?? null,
              expiredAt: result.expiredAt ?? null,
              amount,
              originalAmount: catalogAmount,
              discountAmount: Math.max(0, catalogAmount - discountedBase),
            }
          : undefined,
      manualTransfer,
    };
  }

  private async redeemVoucherForPayment(
    payment: typeof payments.$inferSelect,
  ): Promise<void> {
    const meta = (payment.metadata ?? {}) as { voucherId?: string };
    const voucherId = meta.voucherId;
    if (!voucherId) return;

    const [existing] = await this.db
      .select({ id: voucherRedemptions.id })
      .from(voucherRedemptions)
      .where(eq(voucherRedemptions.paymentId, payment.id))
      .limit(1);
    if (existing) return;

    await this.vouchers.redeem({
      voucherId,
      paymentId: payment.id,
      userId: payment.userId ?? undefined,
      companyId: payment.companyId ?? undefined,
    });
  }

  private async fulfillPaidPayment(paymentId: string) {
    const payment = await this.db.query.payments.findFirst({
      where: eq(payments.id, paymentId),
    });
    if (!payment || payment.status !== 'PAID') return;

    await this.redeemVoucherForPayment(payment);

    if (payment.type === 'SUBSCRIPTION') {
      await this.subscriptions.onPaymentSuccess(payment.id);
    } else if (payment.type === 'VIEW_ACCESS') {
      await this.viewAccess.onPaymentSuccess(payment.id);
    } else if (payment.type === 'BLACKLIST') {
      await this.blacklists.finalizeFromPayment(payment.id);
    } else if (payment.type === 'AD') {
      await this.ads.onPaymentSuccess(payment.id);
    }
  }

  async approveManualPayment(paymentId: string, actorUserId?: string) {
    const payment = await this.db.query.payments.findFirst({
      where: eq(payments.id, paymentId),
    });
    if (!payment) throw new NotFoundException();
    if (payment.gateway !== 'manual') {
      throw new BadRequestException('Pembayaran ini bukan transfer manual');
    }
    if (payment.status !== 'PENDING') {
      throw new BadRequestException('Pembayaran sudah diproses');
    }
    if (
      !MANUAL_OWNER_APPROVE_TYPES.includes(
        payment.type as (typeof MANUAL_OWNER_APPROVE_TYPES)[number],
      )
    ) {
      throw new BadRequestException(
        'Tipe pembayaran tidak mendukung konfirmasi manual',
      );
    }

    const [paid] = await this.db
      .update(payments)
      .set({ status: 'PAID', paidAt: new Date(), updatedAt: new Date() })
      .where(eq(payments.id, paymentId))
      .returning();

    await this.fulfillPaidPayment(paid.id);

    await this.audit.log({
      action: 'PAYMENT_COMPLETED',
      actorUserId,
      companyId: paid.companyId ?? undefined,
      entityType: 'Payment',
      entityId: paid.id,
      metadata: { type: paid.type, manualApproval: true },
    });

    void this.billingMail.notifyManualPaymentApproved(paid);

    return paid;
  }

  /** Dev/staging only — never expose mock payment completion in production. */
  private assertMockPaymentAllowed(mockSecret?: string): void {
    const nodeEnv = this.config.get<string>('NODE_ENV', 'development');
    if (nodeEnv === 'production') {
      throw new NotFoundException();
    }

    const expected = this.config.get<string>('PAYMENT_MOCK_SECRET');
    if (!expected?.trim()) {
      throw new ForbiddenException(
        'Mock pembayaran nonaktif. Set PAYMENT_MOCK_SECRET di .env (dev/staging).',
      );
    }
    if (mockSecret !== expected) {
      throw new ForbiddenException('Header X-Payment-Mock-Secret tidak valid');
    }
  }

  async createSubscriptionPayment(
    userId: string,
    companyId: string,
    months = 1,
  ) {
    const amount =
      Number(this.config.get('PRICE_SUBSCRIPTION_MONTHLY', 500000)) * months;
    const orderId = `SUB-${uuidv4()}`;
    const user = await this.db.query.users.findFirst({
      where: eq(users.id, userId),
    });
    if (!user) throw new NotFoundException();

    const [payment] = await this.db
      .insert(payments)
      .values({
        userId,
        companyId,
        type: 'SUBSCRIPTION',
        amount: String(amount),
        gatewayOrderId: orderId,
        gateway: this.gatewayFactory.gatewayName(),
        metadata: { months },
      })
      .returning();

    const sub = await this.subscriptions.createPending(
      userId,
      companyId,
      payment.id,
    );

    const result = await this.gateway().createPayment({
      orderId,
      amount,
      customerEmail: user.email,
      customerName: user.fullName,
      itemName: `Langganan WorkRecord ${months} bulan`,
    });
    await this.persistWinpayMeta(payment.id, result);

    return { paymentId: payment.id, subscriptionId: sub.id, ...result };
  }

  private normalizeVoucherCode(code?: string): string | undefined {
    const trimmed = code?.trim();
    return trimmed ? trimmed.toUpperCase() : undefined;
  }

  private async findPendingBlacklistPayment(input: {
    companyId: string;
    employeeRecordId: string;
    changeRequestId?: string;
  }) {
    const rows = await this.db
      .select()
      .from(payments)
      .where(
        and(
          eq(payments.companyId, input.companyId),
          eq(payments.type, 'BLACKLIST'),
          eq(payments.status, 'PENDING'),
        ),
      )
      .orderBy(desc(payments.createdAt));

    for (const row of rows) {
      const meta = (row.metadata ?? {}) as {
        employeeRecordId?: string;
        changeRequestId?: string;
      };
      if (meta.employeeRecordId !== input.employeeRecordId) continue;
      if (input.changeRequestId !== undefined) {
        if (meta.changeRequestId !== input.changeRequestId) continue;
      } else if (meta.changeRequestId) {
        continue;
      }
      return row;
    }
    return null;
  }

  private checkoutResponseFromPayment(payment: typeof payments.$inferSelect) {
    const meta = (payment.metadata ?? {}) as Record<string, unknown>;
    const amount = Number(payment.amount);
    const catalogAmountRaw = meta.originalAmount;
    const catalogAmount =
      typeof catalogAmountRaw === 'number'
        ? catalogAmountRaw
        : catalogAmountRaw != null
          ? Number(catalogAmountRaw)
          : amount;
    const discountedBase =
      typeof meta.discountedAmount === 'number'
        ? meta.discountedAmount
        : catalogAmount;

    let manualTransfer;
    if (meta.manualBankSnapshot) {
      const snap = meta.manualBankSnapshot as {
        bankName: string;
        accountNumber: string;
        accountHolder: string;
        label?: string | null;
      };
      const uniqueCodeRaw = meta.uniqueCode;
      const uniqueCode =
        typeof uniqueCodeRaw === 'number'
          ? uniqueCodeRaw
          : Number(uniqueCodeRaw);
      if (Number.isFinite(uniqueCode)) {
        manualTransfer = this.buildManualTransferPayload(
          {
            id: String(meta.manualBankAccountId ?? ''),
            bankName: snap.bankName,
            accountNumber: snap.accountNumber,
            accountHolder: snap.accountHolder,
            label: snap.label ?? undefined,
          },
          amount,
          typeof meta.baseAmount === 'number' ? meta.baseAmount : amount,
          uniqueCode,
        );
      }
    }

    const winpay = meta.winpay as
      | {
          qrUrl?: string | null;
          qrContent?: string | null;
          contractId?: string | null;
          expiredAt?: string | null;
        }
      | undefined;
    const discountAmount = Math.max(0, catalogAmount - discountedBase);
    const qris =
      winpay && (winpay.qrUrl || winpay.qrContent)
        ? {
            paymentId: payment.id,
            qrUrl: winpay.qrUrl ?? null,
            qrContent: winpay.qrContent ?? null,
            contractId: winpay.contractId ?? null,
            expiredAt: winpay.expiredAt ?? null,
            amount,
            originalAmount: catalogAmount,
            discountAmount,
          }
        : undefined;

    return {
      paymentId: payment.id,
      amount,
      originalAmount: catalogAmount,
      discountedAmount: discountedBase,
      discountAmount: Math.max(0, catalogAmount - discountedBase),
      redirectUrl: undefined as string | undefined,
      manualTransfer,
      qris,
    };
  }

  async createBlacklistPayment(input: {
    userId: string;
    companyId: string;
    employeeRecordId: string;
    email: string;
    note: string;
    voucherCode?: string;
    changeRequestId?: string;
    manualBankAccountId?: string;
  }) {
    const voucherCode = this.normalizeVoucherCode(input.voucherCode);
    const baseAmount = await this.pricing.getBlacklistPriceIdr();
    const priced = await this.vouchers.applyToAmount(
      'BLACKLIST',
      baseAmount,
      voucherCode,
      input.companyId,
    );
    const amount = priced.amount;
    const orderId = `BLK-${uuidv4()}`;
    const user = await this.db.query.users.findFirst({
      where: eq(users.id, input.userId),
    });
    if (!user) throw new NotFoundException();

    const existingPending = await this.findPendingBlacklistPayment({
      companyId: input.companyId,
      employeeRecordId: input.employeeRecordId,
      changeRequestId: input.changeRequestId,
    });

    if (existingPending) {
      const pendingMeta = (existingPending.metadata ?? {}) as {
        voucherCode?: string;
      };
      const samePrice =
        Number(existingPending.amount) === amount &&
        (pendingMeta.voucherCode ?? '') === (voucherCode ?? '');
      if (!samePrice) {
        await this.db
          .update(payments)
          .set({
            status: 'EXPIRED',
            metadata: {
              ...((existingPending.metadata ?? {}) as Record<string, unknown>),
              supersededByVoucher: true,
            },
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(payments.id, existingPending.id),
              eq(payments.status, 'PENDING'),
            ),
          );
      } else {
      const reused = this.checkoutResponseFromPayment(existingPending);
      if (reused.manualTransfer || reused.qris) return reused;
      if (
        existingPending.gateway === 'winpay' &&
        existingPending.gatewayOrderId
      ) {
        const result = await this.gateway().createPayment({
          orderId: existingPending.gatewayOrderId,
          amount: Number(existingPending.amount),
          customerEmail: input.email,
          customerName: user.fullName,
          itemName: 'Blacklist / sanggahan karyawan — WorkRecord',
        });
        await this.persistWinpayMeta(existingPending.id, result);
        if (!result.qrUrl && !result.qrContent) {
          throw new BadRequestException(
            'Gateway pembayaran tidak mengembalikan QRIS. Coba lagi beberapa saat.',
          );
        }
        return {
          ...reused,
          qris: {
            paymentId: existingPending.id,
            qrUrl: result.qrUrl ?? null,
            qrContent: result.qrContent ?? null,
            contractId: result.contractId ?? null,
            expiredAt: result.expiredAt ?? null,
            amount: Number(existingPending.amount),
            originalAmount: reused.originalAmount,
            discountAmount: reused.discountAmount,
          },
        };
      }
      return reused;
      }
    }

    if (amount <= 0) {
      return this.settleFreeBlacklistPayment({
        userId: input.userId,
        companyId: input.companyId,
        employeeRecordId: input.employeeRecordId,
        email: input.email,
        note: input.note,
        orderId,
        baseAmount,
        voucherId: priced.voucherId,
        voucherCode,
        changeRequestId: input.changeRequestId,
      });
    }

    const [payment] = await this.db
      .insert(payments)
      .values({
        userId: input.userId,
        companyId: input.companyId,
        type: 'BLACKLIST',
        amount: String(amount),
        gatewayOrderId: orderId,
        gateway: this.gatewayFactory.gatewayName(),
        metadata: {
          employeeRecordId: input.employeeRecordId,
          email: input.email,
          note: input.note,
          voucherId: priced.voucherId,
          voucherCode,
          originalAmount: baseAmount,
          discountedAmount: amount,
          changeRequestId: input.changeRequestId,
        },
      })
      .returning();

    return this.finalizeCheckout(payment, {
      orderId,
      customerEmail: input.email,
      customerName: user.fullName,
      itemName: 'Blacklist / sanggahan karyawan — WorkRecord',
      baseAmount: amount,
      manualBankAccountId: input.manualBankAccountId,
    });
  }

  async createDisputePayment(input: {
    userId: string;
    companyId: string;
    employeeRecordId?: string;
    email: string;
    voucherCode?: string;
    manualBankAccountId?: string;
  }) {
    const voucherCode = this.normalizeVoucherCode(input.voucherCode);
    const baseAmount = await this.pricing.getDisputePriceIdr();
    const priced = await this.vouchers.applyToAmount(
      'DISPUTE',
      baseAmount,
      voucherCode,
      input.companyId,
    );
    const amount = priced.amount;
    const orderId = `DSP-${uuidv4()}`;
    const user = await this.db.query.users.findFirst({
      where: eq(users.id, input.userId),
    });
    if (!user) throw new NotFoundException();

    const [payment] = await this.db
      .insert(payments)
      .values({
        userId: input.userId,
        companyId: input.companyId,
        type: 'DISPUTE',
        amount: String(amount),
        gatewayOrderId: orderId,
        gateway: this.gatewayFactory.gatewayName(),
        metadata: {
          employeeRecordId: input.employeeRecordId,
          email: input.email,
          voucherId: priced.voucherId,
          voucherCode,
          originalAmount: baseAmount,
          discountedAmount: amount,
        },
      })
      .returning();

    return this.finalizeCheckout(payment, {
      orderId,
      customerEmail: input.email,
      customerName: user.fullName,
      itemName: 'Sanggahan pekerja — WorkRecord',
      baseAmount: amount,
      manualBankAccountId: input.manualBankAccountId,
    });
  }

  async createViewAccessPayment(input: {
    email: string;
    companyId: string;
    employeeRecordId?: string;
    durationUnit: ViewDurationUnit;
    durationValue: number;
    userId?: string;
  }) {
    const amount = this.calculateViewPrice(
      input.durationUnit,
      input.durationValue,
    );
    const orderId = `VIEW-${uuidv4()}`;

    const [payment] = await this.db
      .insert(payments)
      .values({
        userId: input.userId,
        companyId: input.companyId,
        type: 'VIEW_ACCESS',
        amount: String(amount),
        gatewayOrderId: orderId,
        gateway: this.gatewayFactory.gatewayName(),
        metadata: {
          scope: input.employeeRecordId ? 'SINGLE_EMPLOYEE' : 'ALL_COMPANY',
          employeeRecordId: input.employeeRecordId,
          durationUnit: input.durationUnit,
          durationValue: input.durationValue,
          email: input.email,
        },
      })
      .returning();

    const result = await this.gateway().createPayment({
      orderId,
      amount,
      customerEmail: input.email,
      customerName: input.email,
      itemName: 'Akses lihat record karyawan',
    });
    await this.persistWinpayMeta(payment.id, result);

    return { paymentId: payment.id, ...result };
  }

  private calculateViewPrice(unit: ViewDurationUnit, value: number): number {
    const hourly = Number(this.config.get('PRICE_VIEW_HOUR', 25000));
    const daily = Number(this.config.get('PRICE_VIEW_DAY', 75000));
    const monthly = Number(this.config.get('PRICE_VIEW_MONTH', 200000));

    switch (unit) {
      case 'HOUR':
        return hourly * value;
      case 'DAY':
        return daily * value;
      case 'MONTH':
        return monthly * value;
      default:
        throw new BadRequestException('Invalid duration unit');
    }
  }

  async handleWebhook(payload: Record<string, unknown>) {
    const verified = await this.gateway().verifyNotification(payload);
    const payment = await this.db.query.payments.findFirst({
      where: eq(payments.gatewayOrderId, verified.orderId),
    });
    if (!payment) {
      return { ok: false, reason: 'payment_not_found' };
    }

    const success =
      verified.transactionStatus === 'capture' ||
      verified.transactionStatus === 'settlement';
    const pending = verified.transactionStatus === 'pending';
    const cancelledByUser = Boolean(
      (payment.metadata as { cancelledByUser?: boolean } | null)?.cancelledByUser,
    );
    if (cancelledByUser) {
      return { ok: true, ignored: 'cancelled' };
    }

    if (success && payment.status !== 'PAID') {
      await this.db
        .update(payments)
        .set({
          status: 'PAID',
          paidAt: new Date(),
          gatewayTxnId: String(
            payload.transaction_id ?? payload.originalReferenceNo ?? '',
          ),
          updatedAt: new Date(),
        })
        .where(eq(payments.id, payment.id));

      await this.fulfillPaidPayment(payment.id);

      await this.audit.log({
        action: 'PAYMENT_COMPLETED',
        actorUserId: payment.userId ?? undefined,
        companyId: payment.companyId ?? undefined,
        entityType: 'Payment',
        entityId: payment.id,
        metadata: { type: payment.type, gateway: payment.gateway },
      });
      this.live.publish({
        type: 'payment.updated',
        paymentId: payment.id,
        status: 'PAID',
        paymentType: payment.type,
        companyId: payment.companyId,
        gateway: payment.gateway,
        paidAt: new Date().toISOString(),
      });
    } else if (!success && !pending && payment.status === 'PENDING') {
      await this.db
        .update(payments)
        .set({ status: 'FAILED', updatedAt: new Date() })
        .where(eq(payments.id, payment.id));
      this.live.publish({
        type: 'payment.updated',
        paymentId: payment.id,
        status: 'FAILED',
        paymentType: payment.type,
        companyId: payment.companyId,
        gateway: payment.gateway,
        paidAt: null,
      });
    }

    return { ok: true };
  }

  private async persistWinpayMeta(
    paymentId: string,
    result: {
      contractId?: string;
      qrUrl?: string;
      qrContent?: string | null;
      expiredAt?: string;
    },
  ) {
    if (!result.contractId && !result.qrUrl && !result.qrContent) return;
    const payment = await this.db.query.payments.findFirst({
      where: eq(payments.id, paymentId),
    });
    if (!payment) return;
    const meta = {
      ...((payment.metadata ?? {}) as Record<string, unknown>),
      winpay: {
        contractId: result.contractId ?? null,
        qrUrl: result.qrUrl ?? null,
        qrContent: result.qrContent ?? null,
        expiredAt: result.expiredAt ?? null,
      },
    };
    await this.db
      .update(payments)
      .set({
        metadata: meta,
        gatewayTxnId: result.contractId,
        updatedAt: new Date(),
      })
      .where(eq(payments.id, paymentId));
  }

  async handleWinpayCallback(input: {
    path: string;
    rawBody: string;
    body: Record<string, unknown>;
    timestamp?: string;
    signature?: string;
  }) {
    this.gatewayFactory.getWinpay().assertCallbackSignature(input);
    await this.handleWebhook(input.body);
    return {
      responseCode: '2005200',
      responseMessage: 'success',
    };
  }

  private async assertCompanyPaymentAccess(
    payment: { userId: string | null; companyId: string | null },
    actorUserId: string,
  ) {
    if (!payment.userId || payment.userId === actorUserId) return;
    const actor = await this.db.query.users.findFirst({
      where: eq(users.id, actorUserId),
    });
    if (
      actor &&
      payment.companyId &&
      actor.companyId === payment.companyId
    ) {
      return;
    }
    throw new ForbiddenException('Pembayaran ini bukan milik akun Anda');
  }

  async cancelPendingPayment(paymentId: string, actorUserId: string) {
    const payment = await this.db.query.payments.findFirst({
      where: eq(payments.id, paymentId),
    });
    if (!payment) throw new NotFoundException();
    await this.assertCompanyPaymentAccess(payment, actorUserId);
    if (payment.type !== 'BLACKLIST') {
      throw new BadRequestException(
        'Hanya pembayaran sanggahan yang bisa dibatalkan dari daftar ini',
      );
    }
    if (payment.status === 'PAID') {
      throw new BadRequestException(
        'Pembayaran sudah diterima dan tidak bisa dibatalkan',
      );
    }
    if (payment.status !== 'PENDING') {
      return { paymentId: payment.id, status: payment.status };
    }

    const metadata = {
      ...((payment.metadata ?? {}) as Record<string, unknown>),
      cancelledByUser: true,
      cancelledAt: new Date().toISOString(),
      cancelledByUserId: actorUserId,
    };
    await this.db
      .update(payments)
      .set({
        status: 'EXPIRED',
        metadata,
        updatedAt: new Date(),
      })
      .where(and(eq(payments.id, payment.id), eq(payments.status, 'PENDING')));

    this.live.publish({
      type: 'payment.updated',
      paymentId: payment.id,
      status: 'FAILED',
      paymentType: payment.type,
      companyId: payment.companyId,
      gateway: payment.gateway,
      paidAt: null,
    });

    return { paymentId: payment.id, status: 'EXPIRED' as const };
  }

  private async settleFreeBlacklistPayment(input: {
    userId: string;
    companyId: string;
    employeeRecordId: string;
    email: string;
    note: string;
    orderId: string;
    baseAmount: number;
    voucherId?: string;
    voucherCode?: string;
    changeRequestId?: string;
  }) {
    const [payment] = await this.db
      .insert(payments)
      .values({
        userId: input.userId,
        companyId: input.companyId,
        type: 'BLACKLIST',
        status: 'PAID',
        amount: '0',
        gatewayOrderId: input.orderId,
        gateway: this.gatewayFactory.gatewayName(),
        paidAt: new Date(),
        metadata: {
          employeeRecordId: input.employeeRecordId,
          email: input.email,
          note: input.note,
          voucherId: input.voucherId,
          voucherCode: input.voucherCode,
          originalAmount: input.baseAmount,
          discountedAmount: 0,
          changeRequestId: input.changeRequestId,
          settledByVoucher: true,
        },
      })
      .returning();

    await this.fulfillPaidPayment(payment.id);
    this.live.publish({
      type: 'payment.updated',
      paymentId: payment.id,
      status: 'PAID',
      paymentType: payment.type,
      companyId: payment.companyId,
      gateway: payment.gateway,
      paidAt: payment.paidAt?.toISOString() ?? new Date().toISOString(),
    });

    return {
      paymentId: payment.id,
      amount: 0,
      originalAmount: input.baseAmount,
      discountedAmount: 0,
      discountAmount: input.baseAmount,
      settled: true as const,
    };
  }

  async getQrisCheckout(paymentId: string, actorUserId: string) {
    const payment = await this.db.query.payments.findFirst({
      where: eq(payments.id, paymentId),
    });
    if (!payment) throw new NotFoundException();
    await this.assertCompanyPaymentAccess(payment, actorUserId);
    if (payment.status === 'PAID') {
      return { status: 'PAID' as const, paymentId: payment.id, qris: null };
    }
    if (payment.status !== 'PENDING') {
      throw new BadRequestException(
        'Pembayaran ini sudah tidak bisa dilanjutkan',
      );
    }
    const reused = this.checkoutResponseFromPayment(payment);
    if (!reused.qris) {
      throw new BadRequestException('QRIS untuk pembayaran ini tidak tersedia');
    }
    return { status: payment.status, paymentId: payment.id, qris: reused.qris };
  }

  async refreshQrisStatus(paymentId: string, actorUserId: string) {
    const payment = await this.db.query.payments.findFirst({
      where: eq(payments.id, paymentId),
    });
    if (!payment) throw new NotFoundException();
    await this.assertCompanyPaymentAccess(payment, actorUserId);
    if (payment.status === 'PAID') {
      return { status: 'PAID', paymentId: payment.id };
    }
    const meta = (payment.metadata ?? {}) as {
      winpay?: { contractId?: string };
    };
    const contractId = meta.winpay?.contractId ?? payment.gatewayTxnId;
    if (!contractId || !payment.gatewayOrderId) {
      throw new BadRequestException('Data QRIS Winpay belum lengkap');
    }
    const queried = await this.gatewayFactory
      .getWinpay()
      .queryPayment(payment.gatewayOrderId, contractId);
    await this.handleWebhook({
      originalPartnerReferenceNo: payment.gatewayOrderId,
      latestTransactionStatus: queried.latestTransactionStatus,
      originalReferenceNo: queried.originalReferenceNo,
    });
    const fresh = await this.db.query.payments.findFirst({
      where: eq(payments.id, paymentId),
    });
    return {
      status: fresh?.status ?? payment.status,
      paymentId,
      latestTransactionStatus: queried.latestTransactionStatus ?? null,
    };
  }

  async mockComplete(paymentId: string, mockSecret?: string) {
    this.assertMockPaymentAllowed(mockSecret);

    const existing = await this.db.query.payments.findFirst({
      where: eq(payments.id, paymentId),
    });
    if (!existing) throw new NotFoundException();
    if (existing.gateway === 'manual') {
      throw new BadRequestException(
        'Pembayaran transfer manual harus dikonfirmasi admin WorkRecord (Transaksi → Konfirmasi pembayaran).',
      );
    }

    const [payment] = await this.db
      .update(payments)
      .set({ status: 'PAID', paidAt: new Date(), updatedAt: new Date() })
      .where(eq(payments.id, paymentId))
      .returning();
    if (!payment) throw new NotFoundException();
    await this.fulfillPaidPayment(payment.id);
    await this.audit.log({
      action: 'PAYMENT_COMPLETED',
      actorUserId: payment.userId ?? undefined,
      companyId: payment.companyId ?? undefined,
      entityType: 'Payment',
      entityId: payment.id,
      metadata: { type: payment.type, mock: true },
    });
    return payment;
  }
}
