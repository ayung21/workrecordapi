import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { ConfigService } from '@nestjs/config';
import { v4 as uuidv4 } from 'uuid';
import { DatabaseService } from '../database/database.service';
import { adPlacements, payments } from '../database/schema';
import { CreateAdDto } from './dto/create-ad.dto';
import { UpdateAdDto } from './dto/update-ad.dto';
import { PaymentGatewayFactory } from '../payments/payment-gateway.factory';
import { JwtPayload } from '../auth/types/jwt-payload';
import { AccessService } from '../access/access.service';
import { PricingService } from '../pricing/pricing.service';

@Injectable()
export class AdsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly config: ConfigService,
    private readonly gatewayFactory: PaymentGatewayFactory,
    private readonly access: AccessService,
    private readonly pricing: PricingService,
  ) {}

  private get db() {
    return this.database.db;
  }

  listAll() {
    return this.db.select().from(adPlacements).orderBy(desc(adPlacements.createdAt));
  }

  listActivePublic() {
    return this.db
      .select()
      .from(adPlacements)
      .where(eq(adPlacements.status, 'ACTIVE'))
      .orderBy(adPlacements.sortOrder);
  }

  async createForOwner(dto: CreateAdDto) {
    const [row] = await this.db
      .insert(adPlacements)
      .values({
        title: dto.title.trim(),
        subtitle: dto.subtitle?.trim(),
        ctaLabel: dto.ctaLabel?.trim(),
        ctaUrl: dto.ctaUrl?.trim(),
        status: dto.status ?? 'ACTIVE',
        priceAmount: String(dto.priceAmount ?? 0),
        startsAt: dto.startsAt ? new Date(dto.startsAt) : new Date(),
        endsAt: dto.endsAt ? new Date(dto.endsAt) : null,
        sortOrder: dto.sortOrder ?? 0,
      })
      .returning();
    return row;
  }

  async update(id: string, dto: UpdateAdDto) {
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (dto.title !== undefined) patch.title = dto.title.trim();
    if (dto.subtitle !== undefined) patch.subtitle = dto.subtitle?.trim();
    if (dto.ctaLabel !== undefined) patch.ctaLabel = dto.ctaLabel?.trim();
    if (dto.ctaUrl !== undefined) patch.ctaUrl = dto.ctaUrl?.trim();
    if (dto.status !== undefined) patch.status = dto.status;
    if (dto.priceAmount !== undefined) patch.priceAmount = String(dto.priceAmount);
    if (dto.startsAt !== undefined) {
      patch.startsAt = dto.startsAt ? new Date(dto.startsAt) : null;
    }
    if (dto.endsAt !== undefined) {
      patch.endsAt = dto.endsAt ? new Date(dto.endsAt) : null;
    }
    if (dto.sortOrder !== undefined) patch.sortOrder = dto.sortOrder;

    const [row] = await this.db
      .update(adPlacements)
      .set(patch)
      .where(eq(adPlacements.id, id))
      .returning();
    if (!row) throw new NotFoundException();
    return row;
  }

  async checkoutCompanyAd(user: JwtPayload, dto: CreateAdDto) {
    if (!user.companyId) {
      throw new ForbiddenException('Hanya akun perusahaan');
    }
    await this.access.assertPortalCompanyActive(user);

    let amount: number;
    let placement: string | undefined;
    let adPackageId: string | undefined;
    let durationDays: number | undefined;

    if (dto.adPackageId) {
      const pkg = await this.pricing.resolveAdPackageForPurchase(dto.adPackageId);
      amount = Number(pkg.priceIdr);
      placement = pkg.placement;
      adPackageId = pkg.id;
      durationDays = pkg.durationDays;
    } else {
      amount = Number(
        dto.priceAmount ?? this.config.get('PRICE_AD_PLACEMENT', 500000),
      );
    }

    const orderId = `AD-${uuidv4()}`;
    const startsAt = dto.startsAt ? new Date(dto.startsAt) : null;
    let endsAt = dto.endsAt ? new Date(dto.endsAt) : null;
    if (!endsAt && durationDays && startsAt) {
      endsAt = new Date(startsAt.getTime() + durationDays * 86400_000);
    }

    const [ad] = await this.db
      .insert(adPlacements)
      .values({
        companyId: user.companyId,
        adPackageId,
        placement,
        title: dto.title.trim(),
        subtitle: dto.subtitle?.trim(),
        ctaLabel: dto.ctaLabel?.trim() ?? 'Pelajari',
        ctaUrl: dto.ctaUrl?.trim(),
        status: 'PENDING_PAYMENT',
        priceAmount: String(amount),
        startsAt,
        endsAt,
        sortOrder: dto.sortOrder ?? 0,
      })
      .returning();

    const [payment] = await this.db
      .insert(payments)
      .values({
        userId: user.sub,
        companyId: user.companyId,
        type: 'AD',
        amount: String(amount),
        gatewayOrderId: orderId,
        gateway: this.gatewayFactory.gatewayName(),
        metadata: {
          adPlacementId: ad.id,
          adPackageId,
          durationDays,
        },
      })
      .returning();

    await this.db
      .update(adPlacements)
      .set({ paymentId: payment.id, updatedAt: new Date() })
      .where(eq(adPlacements.id, ad.id));

    const result = await this.gatewayFactory.getGateway().createPayment({
      orderId,
      amount,
      customerEmail: user.email,
      customerName: user.publicLoginId,
      itemName: 'Iklan WorkRecord',
    });

    return { adId: ad.id, paymentId: payment.id, amount, ...result };
  }

  async onPaymentSuccess(paymentId: string) {
    const payment = await this.db.query.payments.findFirst({
      where: eq(payments.id, paymentId),
    });
    if (!payment || payment.type !== 'AD') return;
    const meta = payment.metadata as {
      adPlacementId?: string;
      durationDays?: number;
    } | null;
    const adId = meta?.adPlacementId;
    if (!adId) return;
    const start = new Date();
    const patch: Record<string, unknown> = {
      status: 'ACTIVE',
      startsAt: start,
      updatedAt: new Date(),
    };
    if (meta?.durationDays) {
      patch.endsAt = new Date(start.getTime() + meta.durationDays * 86400_000);
    }
    await this.db
      .update(adPlacements)
      .set(patch)
      .where(eq(adPlacements.id, adId));
  }
}
