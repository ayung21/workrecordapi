import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CreatePaymentInput,
  CreatePaymentResult,
  PaymentGateway,
} from './payment-gateway.interface';

/**
 * Placeholder untuk payment gateway Bima Sakti.
 * Integrasi API akan ditambahkan ketika kredensial & dokumentasi tersedia.
 */
@Injectable()
export class BimaSaktiGateway implements PaymentGateway {
  private readonly logger = new Logger(BimaSaktiGateway.name);

  constructor(private readonly config: ConfigService) {}

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    this.logger.warn(
      `Bima Sakti belum diintegrasikan — mock checkout untuk order ${input.orderId}`,
    );
    return {
      redirectUrl: `${this.config.get('APP_URL')}/payments/mock?orderId=${input.orderId}&gateway=bimasakti`,
      raw: { provider: 'bimasakti', status: 'pending_implementation' },
    };
  }

  async verifyNotification(payload: Record<string, unknown>): Promise<{
    orderId: string;
    transactionStatus: string;
    fraudStatus?: string;
  }> {
    return {
      orderId: String(payload.order_id ?? payload.orderId ?? ''),
      transactionStatus: String(
        payload.transaction_status ?? payload.status ?? 'settlement',
      ),
    };
  }
}
