import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { DisputesService } from './disputes.service';
import { PaymentsService } from '../payments/payments.service';
import { CreateDisputeCheckoutDto } from './dto/create-dispute-checkout.dto';
import { CreateDisputeDto } from './dto/create-dispute.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/types/jwt-payload';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { UpdateDisputeStatusDto } from './dto/update-dispute-status.dto';

@ApiTags('disputes')
@Controller('disputes')
export class DisputesController {
  constructor(
    private readonly disputes: DisputesService,
    private readonly payments: PaymentsService,
  ) {}

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('checkout')
  checkout(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateDisputeCheckoutDto,
  ) {
    if (!user.companyId) {
      throw new ForbiddenException('Hanya akun perusahaan');
    }
    return this.payments.createDisputePayment({
      userId: user.sub,
      companyId: user.companyId,
      employeeRecordId: dto.employeeRecordId,
      email: dto.email,
      voucherCode: dto.voucherCode,
    });
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post()
  create(@Body() dto: CreateDisputeDto, @CurrentUser() user: JwtPayload) {
    return this.disputes.create(dto, user.sub);
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
