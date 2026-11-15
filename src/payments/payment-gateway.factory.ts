import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentGateway } from './payment-gateway.interface';
import { MidtransGateway } from './midtrans.gateway';
import { BimaSaktiGateway } from './bimasakti.gateway';
import { ManualGateway } from './manual.gateway';
import { WinpayGateway } from './winpay.gateway';

@Injectable()
export class PaymentGatewayFactory {
  constructor(
    private readonly config: ConfigService,
    private readonly midtrans: MidtransGateway,
    private readonly bimaSakti: BimaSaktiGateway,
    private readonly manual: ManualGateway,
    private readonly winpay: WinpayGateway,
  ) {}

  /** Kosong / whitespace di .env dianggap `manual` (bukan gateway lain). */
  private resolveProvider(): string {
    const raw = this.config.get<string>('PAYMENT_GATEWAY', 'manual') ?? '';
    const provider = raw.trim().toLowerCase();
    if (!provider || provider === 'manual') return 'manual';
    return provider;
  }

  getGateway(): PaymentGateway {
    const provider = this.resolveProvider();
    if (provider === 'midtrans') return this.midtrans;
    if (provider === 'bimasakti') return this.bimaSakti;
    if (provider === 'winpay') return this.winpay;
    return this.manual;
  }

  getWinpay(): WinpayGateway {
    return this.winpay;
  }

  gatewayName(): string {
    return this.resolveProvider();
  }

  isManual(): boolean {
    return this.resolveProvider() === 'manual';
  }
}
