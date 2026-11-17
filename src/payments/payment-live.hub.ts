import { Injectable } from '@nestjs/common';
import type { WebSocket } from 'ws';

export type PaymentLiveEvent = {
  type: 'payment.updated';
  paymentId: string;
  status: 'PAID' | 'FAILED';
  paymentType: string;
  companyId: string | null;
  gateway: string | null;
  paidAt: string | null;
};

@Injectable()
export class PaymentLiveHub {
  private readonly clients = new Set<WebSocket>();

  add(socket: WebSocket) {
    this.clients.add(socket);
    socket.on('close', () => this.clients.delete(socket));
  }

  publish(event: PaymentLiveEvent) {
    const payload = JSON.stringify(event);
    for (const socket of this.clients) {
      if (socket.readyState === socket.OPEN) socket.send(payload);
    }
  }
}
