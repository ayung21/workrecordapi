import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RequireRoles } from '../common/decorators/roles.decorator';
import { PLATFORM_OWNER_ROLE } from '../auth/constants/platform-roles';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/types/jwt-payload';
import { PlatformService } from './platform.service';
import { AuditAction, PaymentType } from '../database/enums';

@ApiTags('platform')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@RequireRoles(PLATFORM_OWNER_ROLE)
@Controller('platform')
export class PlatformController {
  constructor(private readonly platform: PlatformService) {}

  @Get('employee-records')
  listEmployeeRecords(
    @CurrentUser() user: JwtPayload,
    @Query('nik') nik?: string,
    @Query('limit') limit?: string,
  ) {
    return this.platform.listEmployeeRecords(user, {
      nik,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('payments')
  listPayments(
    @Query('limit') limit?: string,
    @Query('type') type?: string,
  ) {
    return this.platform.listPayments(
      limit ? Number(limit) : undefined,
      type as PaymentType | undefined,
    );
  }

  @Get('blacklists')
  listBlacklists(@Query('limit') limit?: string) {
    return this.platform.listBlacklists(limit ? Number(limit) : undefined);
  }

  @Get('reports/summary')
  reportSummary() {
    return this.platform.reportSummary();
  }

  @Get('settings')
  platformSettings(@CurrentUser() user: JwtPayload) {
    return this.platform.getSettings(user);
  }

  @Get('notifications')
  adminNotifications(@CurrentUser() user: JwtPayload) {
    return this.platform.getAdminNotifications(user);
  }

  @Get('audit-logs')
  listAuditLogs(
    @CurrentUser() user: JwtPayload,
    @Query('action') action?: AuditAction,
    @Query('companyId') companyId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.platform.listAuditLogs(user, {
      action,
      companyId,
      limit: limit ? Number(limit) : undefined,
    });
  }
}
