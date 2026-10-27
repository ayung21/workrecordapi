import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RequireRoles } from '../common/decorators/roles.decorator';
import { PLATFORM_OWNER_ROLE } from '../auth/constants/platform-roles';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/types/jwt-payload';
import { Public } from '../common/decorators/public.decorator';
import { VouchersService } from './vouchers.service';
import { CreateVoucherDto } from './dto/create-voucher.dto';
import { UpdateVoucherDto } from './dto/update-voucher.dto';
import { QuoteVoucherDto } from './dto/quote-voucher.dto';
import { VoucherAppliesTo, voucherAppliesTo } from '../database/enums';

@ApiTags('vouchers')
@Controller('vouchers')
export class VouchersController {
  constructor(private readonly vouchers: VouchersService) {}

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @RequireRoles(PLATFORM_OWNER_ROLE)
  @Get()
  list() {
    return this.vouchers.list();
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @RequireRoles(PLATFORM_OWNER_ROLE)
  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateVoucherDto) {
    return this.vouchers.create(dto, user.sub);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @RequireRoles(PLATFORM_OWNER_ROLE)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateVoucherDto) {
    return this.vouchers.update(id, dto);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('available')
  listAvailableForCompany(
    @CurrentUser() user: JwtPayload,
    @Query('appliesTo') appliesTo: string,
  ) {
    if (!user.companyId) {
      throw new ForbiddenException('Hanya akun perusahaan');
    }
    if (!(voucherAppliesTo as readonly string[]).includes(appliesTo)) {
      throw new BadRequestException('appliesTo tidak valid');
    }
    if (appliesTo === 'BLACKLIST') {
      return this.vouchers.listAvailableForSanggahanKaryawan(user.companyId);
    }
    return this.vouchers.listAvailableForCompany(
      user.companyId,
      appliesTo as VoucherAppliesTo,
    );
  }

  @Public()
  @Post('quote')
  quote(@Body() dto: QuoteVoucherDto) {
    if (dto.appliesTo === 'BLACKLIST' || dto.appliesTo === 'DISPUTE') {
      return this.vouchers.quoteForSanggahanKaryawan(
        dto.code,
        dto.amount,
        dto.companyId,
      );
    }
    return this.vouchers.quote(
      dto.code,
      dto.appliesTo,
      dto.amount,
      dto.companyId,
    );
  }
}
