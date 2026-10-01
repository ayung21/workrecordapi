import { Module, forwardRef } from '@nestjs/common';
import { CompaniesService } from './companies.service';
import { CompaniesController } from './companies.controller';
import { PaymentsModule } from '../payments/payments.module';
import { AuthModule } from '../auth/auth.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

@Module({
  imports: [
    PaymentsModule,
    AuthModule,
    forwardRef(() => SubscriptionsModule),
  ],
  providers: [CompaniesService],
  controllers: [CompaniesController],
  exports: [CompaniesService],
})
export class CompaniesModule {}
