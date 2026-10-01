import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { Public } from '../common/decorators/public.decorator';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from './types/jwt-payload';
import { RequestEmailVerifyDto } from './dto/request-email-verify.dto';
import { Req } from '@nestjs/common';
import { Request } from 'express';
import { extractRequestMeta } from '../common/utils/request-context';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.auth.login(dto.login, dto.password, extractRequestMeta(req));
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  changePassword(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.auth.changePassword(user.sub, dto.currentPassword, dto.newPassword);
  }

  @Public()
  @Post('forgot-password')
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.auth.requestPasswordReset(dto.email);
  }

  @Public()
  @Post('reset-password')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto.token, dto.newPassword);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('request-email-verification')
  requestVerify(
    @CurrentUser() user: JwtPayload,
    @Body() dto: RequestEmailVerifyDto,
  ) {
    return this.auth.requestEmailVerification(user.sub, dto.newEmail);
  }

  @Public()
  @Post('verify-email')
  verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.auth.verifyEmail(dto.token);
  }
}
