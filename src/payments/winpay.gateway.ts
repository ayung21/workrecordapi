import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createSign, createVerify, createHash } from 'crypto';
import { readFileSync } from 'fs';
import { isAbsolute, resolve } from 'path';
import {
  CreatePaymentInput,
  CreatePaymentResult,
  PaymentGateway,
} from './payment-gateway.interface';

const QR_GENERATE_PATH = '/v1.0/qr/qr-mpm-generate';
const QR_QUERY_PATH = '/v1.0/qr/qr-mpm-query';

type WinpayJson = Record<string, unknown>;

@Injectable()
export class WinpayGateway implements PaymentGateway {
  private readonly logger = new Logger(WinpayGateway.name);

  constructor(private readonly config: ConfigService) {}

  private baseUrl(): string {
    return (
      this.config.get<string>('WINPAY_BASE_URL') ??
      'https://sandbox-snap.winpay.id'
    ).replace(/\/$/, '');
  }

  private partnerId(): string {
    const id = this.config.get<string>('WINPAY_CLIENT_ID')?.trim();
    if (!id) {
      throw new BadRequestException(
        'WINPAY_CLIENT_ID kosong. Isi kredensial sandbox di .env API.',
      );
    }
    return id;
  }

  private readPem(envName: string): string {
    const raw = this.config.get<string>(envName)?.trim();
    if (!raw) {
      throw new BadRequestException(`${envName} belum diisi.`);
    }
    if (raw.includes('BEGIN ')) return raw.replace(/\\n/g, '\n');
    const path = isAbsolute(raw) ? raw : resolve(process.cwd(), raw);
    return readFileSync(path, 'utf8');
  }

  /** ISO-8601 WIB tanpa milidetik, sesuai contoh SNAP Winpay. */
  private firstText(...values: unknown[]): string | undefined {
    for (const value of values) {
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return undefined;
  }

  private timestamp(date = new Date()): string {
    const shifted = new Date(date.getTime() + 7 * 60 * 60 * 1000);
    return `${shifted.toISOString().slice(0, 19)}+07:00`;
  }

  private sign(method: string, path: string, body: string, timestamp: string) {
    const hashedBody = createHash('sha256')
      .update(body)
      .digest('hex')
      .toLowerCase();
    const stringToSign = `${method}:${path}:${hashedBody}:${timestamp}`;
    const signer = createSign('RSA-SHA256');
    signer.update(stringToSign);
    signer.end();
    return signer.sign(this.readPem('WINPAY_PRIVATE_KEY_PATH'), 'base64');
  }

  verifyCallbackSignature(input: {
    method: string;
    path: string;
    rawBody: string;
    timestamp: string;
    signature: string;
  }): boolean {
    const hashedBody = createHash('sha256')
      .update(input.rawBody)
      .digest('hex')
      .toLowerCase();
    const stringToSign = `${input.method}:${input.path}:${hashedBody}:${input.timestamp}`;
    const verifier = createVerify('RSA-SHA256');
    verifier.update(stringToSign);
    verifier.end();
    return verifier.verify(
      this.readPem('WINPAY_PUBLIC_KEY_PATH'),
      input.signature,
      'base64',
    );
  }

  private async snapPost(path: string, payload: WinpayJson): Promise<WinpayJson> {
    const body = JSON.stringify(payload);
    const timestamp = this.timestamp();
    const externalId = `${Date.now()}${Math.floor(Math.random() * 1000)
      .toString()
      .padStart(3, '0')}`;
    const res = await fetch(`${this.baseUrl()}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-TIMESTAMP': timestamp,
        'X-SIGNATURE': this.sign('POST', path, body, timestamp),
        'X-PARTNER-ID': this.partnerId(),
        'X-EXTERNAL-ID': externalId,
        'CHANNEL-ID': this.config.get<string>('WINPAY_CHANNEL_ID') ?? 'WEB',
      },
      body,
    });
    const text = await res.text();
    let data: WinpayJson = {};
    try {
      data = text ? (JSON.parse(text) as WinpayJson) : {};
    } catch {
      throw new BadRequestException(`Winpay response bukan JSON: ${text.slice(0, 240)}`);
    }
    const code = String(data.responseCode ?? '');
    if (!res.ok || (code && !code.startsWith('200'))) {
      this.logger.warn(`Winpay ${path} gagal: ${text.slice(0, 500)}`);
      const message = String(data.responseMessage ?? `Winpay error ${res.status}`);
      if (message.includes('cannot be coerced into a public key')) {
        throw new BadRequestException(
          'Winpay menolak signature: public key merchant di dashboard sandbox tidak valid atau belum terpasang. Unggah isi secrets/winpay-merchant-public.pem (header BEGIN PUBLIC KEY) ke akun Client-ID ini. Jangan pakai public key callback dari email Winpay, dan jangan unggah private key.',
        );
      }
      throw new BadRequestException(message);
    }
    return data;
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    const minutes = Number(this.config.get('WINPAY_QR_TTL_MINUTES') ?? 30);
    const expired = new Date(Date.now() + Math.max(2, minutes) * 60_000);
    const data = await this.snapPost(QR_GENERATE_PATH, {
      partnerReferenceNo: input.orderId,
      amount: {
        value: Number(input.amount).toFixed(2),
        currency: 'IDR',
      },
      validityPeriod: this.timestamp(expired),
      additionalInfo: { isStatic: false },
    });
    const extra = (data.additionalInfo ?? {}) as WinpayJson;
    const qrUrl = this.firstText(data.qrUrl, extra.qrUrl, extra.qrImage);
    const qrContent = this.firstText(
      data.qrContent,
      extra.qrContent,
      data.qrString,
      extra.qrString,
    );
    const contractId = this.firstText(
      extra.contractId,
      data.contractId,
      data.referenceNo,
    );
    return {
      qrUrl,
      qrContent: qrContent ?? null,
      contractId,
      expiredAt: extra.expiredAt
        ? String(extra.expiredAt)
        : this.timestamp(expired),
      raw: data,
    };
  }

  async queryPayment(orderId: string, contractId: string): Promise<WinpayJson> {
    return this.snapPost(QR_QUERY_PATH, {
      originalPartnerReferenceNo: orderId,
      serviceCode: '47',
      additionalInfo: { contractId },
    });
  }

  async verifyNotification(payload: Record<string, unknown>): Promise<{
    orderId: string;
    transactionStatus: string;
    fraudStatus?: string;
  }> {
    const orderId = String(
      payload.originalPartnerReferenceNo ?? payload.order_id ?? '',
    );
    const snapStatus = String(
      payload.latestTransactionStatus ?? payload.transaction_status ?? '',
    );
    return {
      orderId,
      transactionStatus: mapSnapStatus(snapStatus),
    };
  }

  assertCallbackSignature(input: {
    path: string;
    rawBody: string;
    timestamp?: string;
    signature?: string;
  }) {
    if (!input.timestamp || !input.signature) {
      throw new UnauthorizedException('Header callback Winpay tidak lengkap');
    }
    const ok = this.verifyCallbackSignature({
      method: 'POST',
      path: input.path,
      rawBody: input.rawBody,
      timestamp: input.timestamp,
      signature: input.signature,
    });
    if (!ok) {
      throw new UnauthorizedException('Signature callback Winpay tidak valid');
    }
  }
}

/** SNAP latestTransactionStatus → status yang sudah dipakai webhook internal. */
export function mapSnapStatus(code: string): string {
  if (code === '00' || code === 'settlement' || code === 'capture') {
    return 'settlement';
  }
  if (code === '01' || code === '02' || code === '03' || code === 'pending') {
    return 'pending';
  }
  return code || 'failed';
}
