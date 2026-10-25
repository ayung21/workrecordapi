import { Module, forwardRef } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { MidtransGateway } from './midtrans.gateway';
import { BimaSaktiGateway } from './bimasakti.gateway';
import { ManualGateway } from './manual.gateway';
import { PaymentGatewayFactory } from './payment-gateway.factory';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { ViewAccessModule } from '../view-access/view-access.module';
import { BlacklistsModule } from '../blacklists/blacklists.module';
import { VouchersModule } from '../vouchers/vouchers.module';
import { AdsModule } from '../ads/ads.module';

@Module({
  imports: [
    forwardRef(() => SubscriptionsModule),
    forwardRef(() => ViewAccessModule),
    forwardRef(() => BlacklistsModule),
    VouchersModule,
    forwardRef(() => AdsModule),
  ],
  providers: [
    PaymentsService,
    MidtransGateway,
    BimaSaktiGateway,
    ManualGateway,
    PaymentGatewayFactory,
  ],
  controllers: [PaymentsController],
  exports: [PaymentsService, PaymentGatewayFactory],
})
export class PaymentsModule {}
