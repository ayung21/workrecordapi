import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
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
import { ActivateAccountDto } from './dto/activate-account.dto';
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

  @Public()
  @Post('admin/login')
  loginPlatformAdmin(@Body() dto: LoginDto, @Req() req: Request) {
    return this.auth.loginPlatformAdmin(
      dto.login,
      dto.password,
      extractRequestMeta(req),
    );
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: JwtPayload) {
    return this.auth.getProfile(user.sub);
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
    return this.auth.requestPasswordResetOtp(dto.login);
  }

  @Public()
  @Post('reset-password')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPasswordWithOtp(
      dto.login,
      dto.otp,
      dto.newPassword,
    );
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
  @Get('verify-email')
  async verifyEmailFromLink(
    @Query('token') token: string,
    @Res() res: Response,
  ) {
    const html = await this.auth.renderEmailVerificationPage(token ?? '');
    res.type('text/html; charset=utf-8').send(html);
  }

  @Public()
  @Post('verify-email')
  verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.auth.verifyEmail(dto.token);
  }

  @Public()
  @Get('activate-account')
  activationPreview(@Query('token') token: string) {
    return this.auth.getActivationPreview(token);
  }

  @Public()
  @Post('activate-account')
  async activateAccount(@Body() dto: ActivateAccountDto) {
    await this.auth.activateAccount(dto.token, dto.password);
    return { ok: true };
  }
}
