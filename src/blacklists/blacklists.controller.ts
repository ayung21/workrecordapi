import {
  Body,
  Controller,
  ForbiddenException,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { RejectChangeRequestDto } from '../employee-records/dto/reject-change-request.dto';
import { ApproveBlacklistRequestDto } from './dto/approve-blacklist-request.dto';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { BlacklistsService } from './blacklists.service';
import { BlacklistCheckoutDto } from './dto/blacklist-checkout.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/types/jwt-payload';

@ApiTags('blacklists')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('blacklists')
export class BlacklistsController {
  constructor(private readonly blacklists: BlacklistsService) {}

  @Post('checkout')
  checkout(@CurrentUser() user: JwtPayload, @Body() dto: BlacklistCheckoutDto) {
    return this.blacklists.checkout(user, dto);
  }

  @Post('approvals/:requestId/checkout')
  approveAndCheckout(
    @CurrentUser() user: JwtPayload,
    @Param('requestId') requestId: string,
    @Body() dto: ApproveBlacklistRequestDto,
  ) {
    return this.blacklists.checkoutApprovedRequest(user, requestId, dto);
  }

  @Post('approvals/:requestId/reject')
  rejectApproval(
    @CurrentUser() user: JwtPayload,
    @Param('requestId') requestId: string,
    @Body() dto: RejectChangeRequestDto,
  ) {
    return this.blacklists.rejectRequest(user, requestId, dto.rejectionReason);
  }

  @Post('confirm/:paymentId')
  confirm(@Param('paymentId') paymentId: string) {
    return this.blacklists.finalizeFromPayment(paymentId);
  }

  @Patch(':id/cancel')
  cancel(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    if (!user.companyId) {
      throw new ForbiddenException('Hanya akun perusahaan');
    }
    return this.blacklists.cancel(user, id);
  }
}
