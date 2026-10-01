import { Body, Controller, Param, Post } from '@nestjs/common';
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

  @Public()
  @Post(':id/mock-complete')
  async mockComplete(@Param('id') id: string) {
    return this.payments.mockComplete(id);
  }
}
