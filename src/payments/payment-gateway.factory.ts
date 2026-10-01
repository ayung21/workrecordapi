import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentGateway } from './payment-gateway.interface';
import { MidtransGateway } from './midtrans.gateway';
import { BimaSaktiGateway } from './bimasakti.gateway';

@Injectable()
export class PaymentGatewayFactory {
  constructor(
    private readonly config: ConfigService,
    private readonly midtrans: MidtransGateway,
    private readonly bimaSakti: BimaSaktiGateway,
  ) {}

  getGateway(): PaymentGateway {
    const provider = this.config
      .get<string>('PAYMENT_GATEWAY', 'bimasakti')
      .toLowerCase();
    if (provider === 'midtrans') return this.midtrans;
    return this.bimaSakti;
  }

  gatewayName(): string {
    return this.config.get<string>('PAYMENT_GATEWAY', 'bimasakti').toLowerCase();
  }
}
