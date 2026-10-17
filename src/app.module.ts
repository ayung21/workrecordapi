import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { DatabaseModule } from './database/database.module';
import { MailModule } from './mail/mail.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { CompaniesModule } from './companies/companies.module';
import { EmployeeRecordsModule } from './employee-records/employee-records.module';
import { PaymentsModule } from './payments/payments.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { ViewAccessModule } from './view-access/view-access.module';
import { AccessModule } from './access/access.module';
import { DisputesModule } from './disputes/disputes.module';
import { BlacklistsModule } from './blacklists/blacklists.module';
import { TrustController } from './trust/trust.controller';
import { AuditModule } from './audit/audit.module';
import { PlatformModule } from './platform/platform.module';
import { VouchersModule } from './vouchers/vouchers.module';
import { BroadcastsModule } from './broadcasts/broadcasts.module';
import { AdsModule } from './ads/ads.module';
import { RedisModule } from './redis/redis.module';
import { PricingModule } from './pricing/pricing.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    RedisModule,
    PricingModule,
    DatabaseModule,
    AuditModule,
    MailModule,
    AuthModule,
    AccessModule,
    CompaniesModule,
    EmployeeRecordsModule,
    PaymentsModule,
    SubscriptionsModule,
    ViewAccessModule,
    DisputesModule,
    BlacklistsModule,
    PlatformModule,
    VouchersModule,
    BroadcastsModule,
    AdsModule,
  ],
  controllers: [TrustController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
})
export class AppModule {}
