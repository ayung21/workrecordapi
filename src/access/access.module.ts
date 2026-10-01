import { Module } from '@nestjs/common';
import { AccessService } from './access.service';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { ViewAccessModule } from '../view-access/view-access.module';

@Module({
  imports: [SubscriptionsModule, ViewAccessModule],
  providers: [AccessService],
  exports: [AccessService],
})
export class AccessModule {}
