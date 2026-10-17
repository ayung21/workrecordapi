import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
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
  listActive(@Query('placement') placement?: string) {
    return this.ads.listActivePublic(placement);
  }

  @Public()
  @Get(':id/banner')
  async banner(@Param('id') id: string, @Res() res: Response) {
    const { data, mime } = await this.ads.readBannerFile(id);
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.send(data);
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
  @UseGuards(JwtAuthGuard, RolesGuard)
  @RequireRoles(PLATFORM_OWNER_ROLE)
  @Post(':id/banner')
  @UseInterceptors(FileInterceptor('banner'))
  uploadBanner(
    @Param('id') id: string,
    @UploadedFile()
    file: { buffer: Buffer; mimetype: string; size?: number },
  ) {
    return this.ads.uploadBannerImage(id, file);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('checkout')
  checkoutCompany(@CurrentUser() user: JwtPayload, @Body() dto: CreateAdDto) {
    return this.ads.checkoutCompanyAd(user, dto);
  }
}
