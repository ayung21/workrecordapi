import { Body, Controller, Headers, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { PaymentsService } from './payments.service';

@ApiTags('payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Public()
  @Post('webhook/midtrans')
  async midtransWebhook(@Body() body: Record<string, unknown>) {
    return this.payments.handleWebhook(body);
  }

  @Public()
  @Post('webhook/bimasakti')
  async bimaSaktiWebhook(@Body() body: Record<string, unknown>) {
    return this.payments.handleWebhook(body);
  }

  /** Dev/staging: NODE_ENV≠production + header X-Payment-Mock-Secret = PAYMENT_MOCK_SECRET */
  @Public()
  @Post(':id/mock-complete')
  async mockComplete(
    @Param('id') id: string,
    @Headers('x-payment-mock-secret') mockSecret?: string,
  ) {
    return this.payments.mockComplete(id, mockSecret);
  }
}
