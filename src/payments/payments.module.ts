import { Module, forwardRef } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { MidtransGateway } from './midtrans.gateway';
import { BimaSaktiGateway } from './bimasakti.gateway';
import { PaymentGatewayFactory } from './payment-gateway.factory';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { ViewAccessModule } from '../view-access/view-access.module';

@Module({
  imports: [
    forwardRef(() => SubscriptionsModule),
    forwardRef(() => ViewAccessModule),
  ],
  providers: [
    PaymentsService,
    MidtransGateway,
    BimaSaktiGateway,
    PaymentGatewayFactory,
  ],
  controllers: [PaymentsController],
  exports: [PaymentsService],
})
export class PaymentsModule {}
