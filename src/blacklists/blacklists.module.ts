import { Module, forwardRef } from '@nestjs/common';
import { BlacklistsService } from './blacklists.service';
import { BlacklistsController } from './blacklists.controller';
import { PaymentsModule } from '../payments/payments.module';
import { AccessModule } from '../access/access.module';

@Module({
  imports: [forwardRef(() => PaymentsModule), AccessModule],
  providers: [BlacklistsService],
  controllers: [BlacklistsController],
  exports: [BlacklistsService],
})
export class BlacklistsModule {}
