import { Global, Module } from '@nestjs/common';
import { MailService } from './mail.service';
import { BillingMailService } from './billing-mail.service';

@Global()
@Module({
  providers: [MailService, BillingMailService],
  exports: [MailService, BillingMailService],
})
export class MailModule {}
