import { Module, forwardRef } from '@nestjs/common';
import { ViewAccessService } from './view-access.service';
import { ViewAccessController } from './view-access.controller';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [forwardRef(() => PaymentsModule)],
  providers: [ViewAccessService],
  controllers: [ViewAccessController],
  exports: [ViewAccessService],
})
export class ViewAccessModule {}
