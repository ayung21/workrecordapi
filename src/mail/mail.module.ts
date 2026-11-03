import { Global, Module } from '@nestjs/common';
import { MailService } from './mail.service';
import { BillingMailService } from './billing-mail.service';
import { CompanyApprovalMailService } from './company-approval-mail.service';

@Global()
@Module({
  providers: [MailService, BillingMailService, CompanyApprovalMailService],
  exports: [MailService, BillingMailService, CompanyApprovalMailService],
})
export class MailModule {}
