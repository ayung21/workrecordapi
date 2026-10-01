import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { ViewAccessService } from './view-access.service';
import { PaymentsService } from '../payments/payments.service';
import { CreateViewAccessDto } from './dto/create-view-access.dto';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt.guard';
import { UseGuards } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/types/jwt-payload';

@ApiTags('view-access')
@Controller('view-access')
export class ViewAccessController {
  constructor(
    private readonly viewAccess: ViewAccessService,
    private readonly payments: PaymentsService,
  ) {}

  @Public()
  @Post('checkout')
  async checkout(@Body() dto: CreateViewAccessDto) {
    return this.payments.createViewAccessPayment({
      email: dto.email,
      companyId: dto.companyId,
      employeeRecordId: dto.employeeRecordId,
      durationUnit: dto.durationUnit,
      durationValue: dto.durationValue,
      userId: dto.userId,
    });
  }

  @Public()
  @Get('resolve')
  async resolve(@Query('token') token: string) {
    const grant = await this.viewAccess.resolveToken(token);
    if (!grant) {
      return { valid: false };
    }
    return {
      valid: true,
      scope: grant.scope,
      companyId: grant.companyId,
      employeeRecordId: grant.employeeRecordId,
      endsAt: grant.endsAt,
    };
  }

  @UseGuards(OptionalJwtAuthGuard)
  @Get('my-grants')
  async myGrants(@CurrentUser() user?: JwtPayload) {
    if (!user) return [];
    return this.viewAccess.listGrantsForUser(user.sub);
  }
}
