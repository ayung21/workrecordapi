import { Module, forwardRef } from '@nestjs/common';
import { CompaniesService } from './companies.service';
import { CompanyDocumentsService } from './company-documents.service';
import { BlacklistsModule } from '../blacklists/blacklists.module';
import { CompaniesController } from './companies.controller';
import { SiteVerificationVideoService } from './site-verification-video.service';
import { SiteVerificationVideoController } from './site-verification-video.controller';
import { PaymentsModule } from '../payments/payments.module';
import { AuthModule } from '../auth/auth.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { AccessModule } from '../access/access.module';

@Module({
  imports: [
    PaymentsModule,
    AuthModule,
    BlacklistsModule,
    AccessModule,
    forwardRef(() => SubscriptionsModule),
  ],
  providers: [
    CompaniesService,
    CompanyDocumentsService,
    SiteVerificationVideoService,
  ],
  controllers: [CompaniesController, SiteVerificationVideoController],
  exports: [CompaniesService, SiteVerificationVideoService],
})
export class CompaniesModule {}
