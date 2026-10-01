import { Module, forwardRef } from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionsController } from './subscriptions.controller';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [forwardRef(() => PaymentsModule)],
  providers: [SubscriptionsService],
  controllers: [SubscriptionsController],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
