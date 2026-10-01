import {
  BadRequestException,
  Inject,
  Injectable,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PaymentStatus,
  PaymentType,
  Prisma,
  ViewAccessScope,
  ViewDurationUnit,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentGatewayFactory } from './payment-gateway.factory';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { ViewAccessService } from '../view-access/view-access.service';
import { v4 as uuidv4 } from 'uuid';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gatewayFactory: PaymentGatewayFactory,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    @Inject(forwardRef(() => SubscriptionsService))
    private readonly subscriptions: SubscriptionsService,
    @Inject(forwardRef(() => ViewAccessService))
    private readonly viewAccess: ViewAccessService,
  ) {}

  private gateway() {
    return this.gatewayFactory.getGateway();
  }

  async createSubscriptionPayment(
    userId: string,
    companyId: string,
    months = 1,
  ) {
    const amount = Number(
      this.config.get('PRICE_SUBSCRIPTION_MONTHLY', 500000),
    ) * months;
    const orderId = `SUB-${uuidv4()}`;
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });

    const payment = await this.prisma.payment.create({
      data: {
        userId,
        companyId,
        type: PaymentType.SUBSCRIPTION,
        amount,
        gatewayOrderId: orderId,
        gateway: this.gatewayFactory.gatewayName(),
        metadata: { months } as Prisma.InputJsonValue,
      },
    });

    const sub = await this.subscriptions.createPending(userId, companyId, payment.id);

    const result = await this.gateway().createPayment({
      orderId,
      amount,
      customerEmail: user.email,
      customerName: user.fullName,
      itemName: `Langganan WorkRecord ${months} bulan`,
    });

    return { paymentId: payment.id, subscriptionId: sub.id, ...result };
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

    const payment = await this.prisma.payment.create({
      data: {
        userId: input.userId,
        companyId: input.companyId,
        type: PaymentType.VIEW_ACCESS,
        amount,
        gatewayOrderId: orderId,
        gateway: this.gatewayFactory.gatewayName(),
        metadata: {
          scope: input.employeeRecordId
            ? ViewAccessScope.SINGLE_EMPLOYEE
            : ViewAccessScope.ALL_COMPANY,
          employeeRecordId: input.employeeRecordId,
          durationUnit: input.durationUnit,
          durationValue: input.durationValue,
          email: input.email,
        } as Prisma.InputJsonValue,
      },
    });

    const result = await this.gateway().createPayment({
      orderId,
      amount,
      customerEmail: input.email,
      customerName: input.email,
      itemName: 'Akses lihat record karyawan',
    });

    return { paymentId: payment.id, ...result };
  }

  private calculateViewPrice(
    unit: ViewDurationUnit,
    value: number,
  ): number {
    const hourly = Number(this.config.get('PRICE_VIEW_HOUR', 25000));
    const daily = Number(this.config.get('PRICE_VIEW_DAY', 75000));
    const monthly = Number(this.config.get('PRICE_VIEW_MONTH', 200000));

    switch (unit) {
      case ViewDurationUnit.HOUR:
        return hourly * value;
      case ViewDurationUnit.DAY:
        return daily * value;
      case ViewDurationUnit.MONTH:
        return monthly * value;
      default:
        throw new BadRequestException('Invalid duration unit');
    }
  }

  async handleWebhook(payload: Record<string, unknown>) {
    const verified = await this.gateway().verifyNotification(payload);
    const payment = await this.prisma.payment.findUnique({
      where: { gatewayOrderId: verified.orderId },
    });
    if (!payment) {
      return { ok: false, reason: 'payment_not_found' };
    }

    const success =
      verified.transactionStatus === 'capture' ||
      verified.transactionStatus === 'settlement';
    const pending = verified.transactionStatus === 'pending';

    if (success && payment.status !== PaymentStatus.PAID) {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.PAID,
          paidAt: new Date(),
          gatewayTxnId: String(payload.transaction_id ?? ''),
        },
      });

      if (payment.type === PaymentType.SUBSCRIPTION) {
        await this.subscriptions.onPaymentSuccess(payment.id);
      } else if (payment.type === PaymentType.VIEW_ACCESS) {
        await this.viewAccess.onPaymentSuccess(payment.id);
      }

      await this.audit.log({
        action: 'PAYMENT_COMPLETED',
        actorUserId: payment.userId ?? undefined,
        companyId: payment.companyId ?? undefined,
        entityType: 'Payment',
        entityId: payment.id,
        metadata: { type: payment.type, gateway: payment.gateway },
      });
    } else if (!success && !pending && payment.status === PaymentStatus.PENDING) {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.FAILED },
      });
    }

    return { ok: true };
  }

  /** Dev/mock: mark payment paid without gateway */
  async mockComplete(paymentId: string) {
    const payment = await this.prisma.payment.update({
      where: { id: paymentId },
      data: { status: PaymentStatus.PAID, paidAt: new Date() },
    });
    if (payment.type === PaymentType.SUBSCRIPTION) {
      await this.subscriptions.onPaymentSuccess(payment.id);
    } else {
      await this.viewAccess.onPaymentSuccess(payment.id);
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
