import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { SubscriptionsService } from './subscriptions.service';
import { PaymentsService } from '../payments/payments.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/types/jwt-payload';

@ApiTags('subscriptions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('subscriptions')
export class SubscriptionsController {
  constructor(
    private readonly subscriptions: SubscriptionsService,
    private readonly payments: PaymentsService,
  ) {}

  @Post('checkout/:companyId')
  async checkout(
    @CurrentUser() user: JwtPayload,
    @Param('companyId') companyId: string,
  ) {
    return this.payments.createSubscriptionPayment(user.sub, companyId);
  }

  @Get('active/:companyId')
  async active(
    @CurrentUser() user: JwtPayload,
    @Param('companyId') companyId: string,
  ) {
    return this.subscriptions.getActiveSubscription(user.sub, companyId);
  }

  @Post(':id/activate-survey')
  @RequirePermissions('companies.survey')
  async activateSurvey(@Param('id') id: string) {
    return this.subscriptions.activateAfterSurvey(id);
  }
}
