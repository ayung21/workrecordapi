import { Injectable } from '@nestjs/common';
import {
  CreatePaymentInput,
  CreatePaymentResult,
  PaymentGateway,
} from './payment-gateway.interface';

/** Pembayaran transfer manual — tanpa redirect gateway. */
@Injectable()
export class ManualGateway implements PaymentGateway {
  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    return {
      raw: {
        provider: 'manual',
        orderId: input.orderId,
        amount: input.amount,
      },
    };
  }

  async verifyNotification(payload: Record<string, unknown>): Promise<{
    orderId: string;
    transactionStatus: string;
    fraudStatus?: string;
  }> {
    return {
      orderId: String(payload.order_id ?? payload.orderId ?? ''),
      transactionStatus: 'pending',
    };
  }
}
