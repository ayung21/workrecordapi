import { Controller, ForbiddenException, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/types/jwt-payload';
import { SiteVerificationVideoService } from './site-verification-video.service';

@ApiTags('companies')
@ApiBearerAuth()
@Controller('companies/site-verification')
export class SiteVerificationVideoController {
  constructor(private readonly video: SiteVerificationVideoService) {}

  /**
   * Pengaturan video verifikasi lapangan (link meeting vs WebRTC/STUN/TURN).
   * Portal perusahaan & admin bisa baca sebelum implementasi UI WebRTC.
   */
  @UseGuards(JwtAuthGuard)
  @Get('video-settings')
  videoSettings(@CurrentUser() user: JwtPayload) {
    if (user.roleCode !== 'OWNER' && !user.companyId) {
      throw new ForbiddenException('Hanya akun perusahaan atau Owner');
    }
    return this.video.getClientSettings();
  }
}
