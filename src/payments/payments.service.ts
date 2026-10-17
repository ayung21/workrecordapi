import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq } from 'drizzle-orm';
import { ViewDurationUnit } from '../database/enums';
import { DatabaseService } from '../database/database.service';
import { payments, users } from '../database/schema';
import { PaymentGatewayFactory } from './payment-gateway.factory';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { ViewAccessService } from '../view-access/view-access.service';
import { v4 as uuidv4 } from 'uuid';
import { AuditService } from '../audit/audit.service';
import { BlacklistsService } from '../blacklists/blacklists.service';
import { VouchersService } from '../vouchers/vouchers.service';
import { AdsService } from '../ads/ads.service';
import { PricingService } from '../pricing/pricing.service';

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
  ) {}

  private get db() {
    return this.database.db;
  }

  private gateway() {
    return this.gatewayFactory.getGateway();
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

    return { paymentId: payment.id, subscriptionId: sub.id, ...result };
  }

  async createBlacklistPayment(input: {
    userId: string;
    companyId: string;
    employeeRecordId: string;
    email: string;
    note: string;
    voucherCode?: string;
    changeRequestId?: string;
  }) {
    const baseAmount = await this.pricing.getBlacklistPriceIdr();
    const priced = await this.vouchers.applyToAmount(
      'BLACKLIST',
      baseAmount,
      input.voucherCode,
      input.companyId,
    );
    const amount = priced.amount;
    const orderId = `BLK-${uuidv4()}`;
    const user = await this.db.query.users.findFirst({
      where: eq(users.id, input.userId),
    });
    if (!user) throw new NotFoundException();

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
          voucherCode: input.voucherCode,
          originalAmount: baseAmount,
          changeRequestId: input.changeRequestId,
        },
      })
      .returning();

    if (priced.voucherId) {
      await this.vouchers.redeem({
        voucherId: priced.voucherId,
        paymentId: payment.id,
        userId: input.userId,
        companyId: input.companyId,
      });
    }

    const result = await this.gateway().createPayment({
      orderId,
      amount,
      customerEmail: input.email,
      customerName: user.fullName,
      itemName: 'Blacklist / sanggahan karyawan — WorkRecord',
    });

    return { paymentId: payment.id, amount, originalAmount: baseAmount, ...result };
  }

  async createDisputePayment(input: {
    userId: string;
    companyId: string;
    employeeRecordId?: string;
    email: string;
    voucherCode?: string;
  }) {
    const baseAmount = await this.pricing.getDisputePriceIdr();
    const priced = await this.vouchers.applyToAmount(
      'DISPUTE',
      baseAmount,
      input.voucherCode,
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
          voucherCode: input.voucherCode,
          originalAmount: baseAmount,
        },
      })
      .returning();

    if (priced.voucherId) {
      await this.vouchers.redeem({
        voucherId: priced.voucherId,
        paymentId: payment.id,
        userId: input.userId,
        companyId: input.companyId,
      });
    }

    const result = await this.gateway().createPayment({
      orderId,
      amount,
      customerEmail: input.email,
      customerName: user.fullName,
      itemName: 'Sanggahan pekerja — WorkRecord',
    });

    return { paymentId: payment.id, amount, originalAmount: baseAmount, ...result };
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

    if (success && payment.status !== 'PAID') {
      await this.db
        .update(payments)
        .set({
          status: 'PAID',
          paidAt: new Date(),
          gatewayTxnId: String(payload.transaction_id ?? ''),
          updatedAt: new Date(),
        })
        .where(eq(payments.id, payment.id));

      if (payment.type === 'SUBSCRIPTION') {
        await this.subscriptions.onPaymentSuccess(payment.id);
      } else if (payment.type === 'VIEW_ACCESS') {
        await this.viewAccess.onPaymentSuccess(payment.id);
      } else if (payment.type === 'BLACKLIST') {
        await this.blacklists.finalizeFromPayment(payment.id);
      } else if (payment.type === 'AD') {
        await this.ads.onPaymentSuccess(payment.id);
      } else if (payment.type === 'DISPUTE') {
        /* legacy */
      }

      await this.audit.log({
        action: 'PAYMENT_COMPLETED',
        actorUserId: payment.userId ?? undefined,
        companyId: payment.companyId ?? undefined,
        entityType: 'Payment',
        entityId: payment.id,
        metadata: { type: payment.type, gateway: payment.gateway },
      });
    } else if (!success && !pending && payment.status === 'PENDING') {
      await this.db
        .update(payments)
        .set({ status: 'FAILED', updatedAt: new Date() })
        .where(eq(payments.id, payment.id));
    }

    return { ok: true };
  }

  async mockComplete(paymentId: string, mockSecret?: string) {
    this.assertMockPaymentAllowed(mockSecret);

    const [payment] = await this.db
      .update(payments)
      .set({ status: 'PAID', paidAt: new Date(), updatedAt: new Date() })
      .where(eq(payments.id, paymentId))
      .returning();
    if (!payment) throw new NotFoundException();
    if (payment.type === 'SUBSCRIPTION') {
      await this.subscriptions.onPaymentSuccess(payment.id);
    } else if (payment.type === 'VIEW_ACCESS') {
      await this.viewAccess.onPaymentSuccess(payment.id);
    } else if (payment.type === 'BLACKLIST') {
      await this.blacklists.finalizeFromPayment(payment.id);
    } else if (payment.type === 'AD') {
      await this.ads.onPaymentSuccess(payment.id);
    }
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
