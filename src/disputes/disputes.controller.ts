import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { DisputesService } from './disputes.service';
import { CreateDisputeDto } from './dto/create-dispute.dto';
import { Public } from '../common/decorators/public.decorator';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/types/jwt-payload';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { UpdateDisputeStatusDto } from './dto/update-dispute-status.dto';

@ApiTags('disputes')
@Controller('disputes')
export class DisputesController {
  constructor(private readonly disputes: DisputesService) {}

  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Post()
  create(@Body() dto: CreateDisputeDto, @CurrentUser() user?: JwtPayload) {
    return this.disputes.create(dto, user?.sub);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Get('open')
  @RequirePermissions('disputes.manage')
  listOpen() {
    return this.disputes.listOpen();
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Patch(':id/status')
  @RequirePermissions('disputes.manage')
  updateStatus(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateDisputeStatusDto,
  ) {
    return this.disputes.updateStatus(
      id,
      dto.status,
      dto.resolutionNotes,
      user.sub,
    );
  }
}
