import { Module, forwardRef } from '@nestjs/common';
import { AdsService } from './ads.service';
import { AdsController } from './ads.controller';
import { PaymentsModule } from '../payments/payments.module';
import { AccessModule } from '../access/access.module';

@Module({
  imports: [forwardRef(() => PaymentsModule), AccessModule],
  providers: [AdsService],
  controllers: [AdsController],
  exports: [AdsService],
})
export class AdsModule {}
