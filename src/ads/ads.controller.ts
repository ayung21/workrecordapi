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
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RequireRoles } from '../common/decorators/roles.decorator';
import { PLATFORM_OWNER_ROLE } from '../auth/constants/platform-roles';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/types/jwt-payload';
import { Public } from '../common/decorators/public.decorator';
import { AdsService } from './ads.service';
import { CreateAdDto } from './dto/create-ad.dto';
import { UpdateAdDto } from './dto/update-ad.dto';

@ApiTags('ads')
@Controller('ads')
export class AdsController {
  constructor(private readonly ads: AdsService) {}

  @Public()
  @Get('active')
  listActive() {
    return this.ads.listActivePublic();
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @RequireRoles(PLATFORM_OWNER_ROLE)
  @Get()
  listAll() {
    return this.ads.listAll();
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @RequireRoles(PLATFORM_OWNER_ROLE)
  @Post()
  createOwner(@Body() dto: CreateAdDto) {
    return this.ads.createForOwner(dto);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @RequireRoles(PLATFORM_OWNER_ROLE)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateAdDto) {
    return this.ads.update(id, dto);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('checkout')
  checkoutCompany(@CurrentUser() user: JwtPayload, @Body() dto: CreateAdDto) {
    return this.ads.checkoutCompanyAd(user, dto);
  }
}
