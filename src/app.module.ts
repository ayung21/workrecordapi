import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module';
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
import { TrustController } from './trust/trust.controller';
import { AuditModule } from './audit/audit.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
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
