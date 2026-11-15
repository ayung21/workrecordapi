export interface CreatePaymentInput {
  orderId: string;
  amount: number;
  customerEmail: string;
  customerName: string;
  itemName: string;
}

export interface CreatePaymentResult {
  redirectUrl?: string;
  snapToken?: string;
  qrUrl?: string;
  qrContent?: string | null;
  contractId?: string;
  expiredAt?: string;
  raw: unknown;
}

export interface PaymentGateway {
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;
  verifyNotification(payload: Record<string, unknown>): Promise<{
    orderId: string;
    transactionStatus: string;
    fraudStatus?: string;
  }>;
}
