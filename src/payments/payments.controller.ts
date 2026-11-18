import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/types/jwt-payload';
import { PaymentsService } from './payments.service';

@ApiTags('payments')
@Controller()
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Public()
  @Get('payments/manual-instructions')
  manualInstructions() {
    return this.payments.getManualBankInstructions();
  }

  @Public()
  @Post('payments/webhook/midtrans')
  async midtransWebhook(@Body() body: Record<string, unknown>) {
    return this.payments.handleWebhook(body);
  }

  @Public()
  @Post('payments/webhook/bimasakti')
  async bimaSaktiWebhook(@Body() body: Record<string, unknown>) {
    return this.payments.handleWebhook(body);
  }

  /** Path yang didaftarkan ke Winpay: {API_URL}/v1.0/qr/qr-mpm-notify */
  @Public()
  @Post('v1.0/qr/qr-mpm-notify')
  winpayNotify(
    @Req() req: RawBodyRequest<Request>,
    @Body() body: Record<string, unknown>,
    @Headers('x-timestamp') timestamp?: string,
    @Headers('x-signature') signature?: string,
  ) {
    const rawBody = req.rawBody?.toString('utf8') ?? JSON.stringify(body);
    return this.payments.handleWinpayCallback({
      path: '/v1.0/qr/qr-mpm-notify',
      rawBody,
      body,
      timestamp,
      signature,
    });
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('payments/:id/qris')
  qrisCheckout(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.payments.getQrisCheckout(id, user.sub);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('payments/:id/cancel')
  cancelPending(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.payments.cancelPendingPayment(id, user.sub);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('payments/:id/qris-status')
  qrisStatus(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.payments.refreshQrisStatus(id, user.sub);
  }

  /** Dev/staging: NODE_ENV≠production + header X-Payment-Mock-Secret = PAYMENT_MOCK_SECRET */
  @Public()
  @Post('payments/:id/mock-complete')
  async mockComplete(
    @Param('id') id: string,
    @Headers('x-payment-mock-secret') mockSecret?: string,
  ) {
    return this.payments.mockComplete(id, mockSecret);
  }
}
