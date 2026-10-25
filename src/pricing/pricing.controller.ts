import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RequireRoles } from '../common/decorators/roles.decorator';
import { PLATFORM_OWNER_ROLE } from '../auth/constants/platform-roles';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/types/jwt-payload';
import { PricingService } from './pricing.service';
import { UpdateServiceFeesDto } from './dto/update-service-fees.dto';
import { UpdateManualPaymentBankDto } from './dto/update-manual-payment-bank.dto';
import { CreateAdPackageDto } from './dto/create-ad-package.dto';
import { UpdateAdPackageDto } from './dto/update-ad-package.dto';
import { adPlacementSlots } from '../database/enums';

@ApiTags('pricing')
@Controller('pricing')
export class PricingController {
  constructor(private readonly pricing: PricingService) {}

  @Public()
  @Get('catalog')
  catalog() {
    return this.pricing.getPublicCatalog();
  }

  @Public()
  @Get('placement-slots')
  placementSlots() {
    return adPlacementSlots.map((id) => ({
      id,
      label: this.pricing.placementLabel(id),
    }));
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @RequireRoles(PLATFORM_OWNER_ROLE)
  @Get('admin/config')
  adminConfig() {
    return this.pricing.getPublicCatalog().then(async (catalog) => ({
      ...catalog,
      adPackagesAll: await this.pricing.listAdPackages(true),
    }));
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @RequireRoles(PLATFORM_OWNER_ROLE)
  @Patch('admin/service-fees')
  updateFees(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateServiceFeesDto,
  ) {
    return this.pricing.setServiceFees(dto, user.sub);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @RequireRoles(PLATFORM_OWNER_ROLE)
  @Patch('admin/manual-payment-bank')
  updateManualPaymentBank(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateManualPaymentBankDto,
  ) {
    return this.pricing.setManualPaymentBanks(dto.accounts, user.sub);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @RequireRoles(PLATFORM_OWNER_ROLE)
  @Post('admin/ad-packages')
  createAdPackage(@Body() dto: CreateAdPackageDto) {
    return this.pricing.createAdPackage(dto);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @RequireRoles(PLATFORM_OWNER_ROLE)
  @Patch('admin/ad-packages/:id')
  updateAdPackage(@Param('id') id: string, @Body() dto: UpdateAdPackageDto) {
    return this.pricing.updateAdPackage(id, dto);
  }
}
