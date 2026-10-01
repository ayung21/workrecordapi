import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuditAction } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/types/jwt-payload';
import { AuditService } from './audit.service';
import { ForbiddenException } from '@nestjs/common';

@ApiTags('audit')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  async list(
    @CurrentUser() user: JwtPayload,
    @Query('companyId') companyId?: string,
    @Query('action') action?: AuditAction,
    @Query('limit') limit?: string,
  ) {
    if (user.roleCode === 'OWNER') {
      return this.audit.list({
        companyId,
        action,
        limit: limit ? Number(limit) : undefined,
      });
    }

    if (!companyId || user.companyId !== companyId) {
      throw new ForbiddenException('Hanya audit PT Anda sendiri');
    }

    const allowed =
      user.roleCode === 'COMPANY_ADMIN' ||
      user.roleCode === 'COMPANY_LEADERSHIP';
    if (!allowed) {
      throw new ForbiddenException();
    }

    return this.audit.list({
      companyId,
      action,
      limit: limit ? Number(limit) : undefined,
    });
  }
}
