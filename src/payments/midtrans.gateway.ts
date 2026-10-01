import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CreatePaymentInput,
  CreatePaymentResult,
  PaymentGateway,
} from './payment-gateway.interface';

@Injectable()
export class MidtransGateway implements PaymentGateway {
  private readonly logger = new Logger(MidtransGateway.name);
  private readonly serverKey: string;
  private readonly isProduction: boolean;

  constructor(private readonly config: ConfigService) {
    this.serverKey = this.config.get<string>('MIDTRANS_SERVER_KEY', '');
    this.isProduction =
      this.config.get<string>('MIDTRANS_IS_PRODUCTION', 'false') === 'true';
  }

  private baseUrl(): string {
    return this.isProduction
      ? 'https://app.midtrans.com'
      : 'https://app.sandbox.midtrans.com';
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    if (!this.serverKey) {
      this.logger.warn('Midtrans not configured — returning mock payment URL');
      return {
        redirectUrl: `${this.config.get('APP_URL')}/payments/mock?orderId=${input.orderId}`,
        raw: { mock: true },
      };
    }

    const body = {
      transaction_details: {
        order_id: input.orderId,
        gross_amount: input.amount,
      },
      customer_details: {
        email: input.customerEmail,
        first_name: input.customerName,
      },
      item_details: [
        {
          id: input.orderId,
          price: input.amount,
          quantity: 1,
          name: input.itemName,
        },
      ],
    };

    const res = await fetch(`${this.baseUrl()}/snap/v1/transactions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${Buffer.from(`${this.serverKey}:`).toString('base64')}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Midtrans error: ${text}`);
    }

    const data = (await res.json()) as { token: string; redirect_url: string };
    return {
      snapToken: data.token,
      redirectUrl: data.redirect_url,
      raw: data,
    };
  }

  async verifyNotification(payload: Record<string, unknown>): Promise<{
    orderId: string;
    transactionStatus: string;
    fraudStatus?: string;
  }> {
    return {
      orderId: String(payload.order_id),
      transactionStatus: String(payload.transaction_status),
      fraudStatus: payload.fraud_status
        ? String(payload.fraud_status)
        : undefined,
    };
  }
}
