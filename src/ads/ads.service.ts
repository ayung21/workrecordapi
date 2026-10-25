import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { and, desc, eq, gt, inArray, isNull, lte, or } from 'drizzle-orm';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { existsSync } from 'fs';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { DatabaseService } from '../database/database.service';
import { adPlacements, payments } from '../database/schema';
import { CreateAdDto } from './dto/create-ad.dto';
import { UpdateAdDto } from './dto/update-ad.dto';
import { PaymentGatewayFactory } from '../payments/payment-gateway.factory';
import { PaymentsService } from '../payments/payments.service';
import { JwtPayload } from '../auth/types/jwt-payload';
import { AccessService } from '../access/access.service';
import { PricingService } from '../pricing/pricing.service';
import { compressUploadedImage } from '../common/utils/compress-image';

@Injectable()
export class AdsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly config: ConfigService,
    private readonly gatewayFactory: PaymentGatewayFactory,
    @Inject(forwardRef(() => PaymentsService))
    private readonly payments: PaymentsService,
    private readonly access: AccessService,
    private readonly pricing: PricingService,
  ) {}

  private get db() {
    return this.database.db;
  }

  private uploadRoot() {
    return this.config.get<string>('UPLOAD_DIR') ?? join(process.cwd(), 'uploads');
  }

  private serializeAd<T extends { id: string; bannerImagePath?: string | null }>(
    row: T,
  ) {
    const { bannerImagePath, ...rest } = row;
    const hasBannerFile =
      typeof bannerImagePath === 'string' &&
      bannerImagePath.length > 0 &&
      existsSync(bannerImagePath);
    return {
      ...rest,
      bannerImageUrl: hasBannerFile ? `ads/${row.id}/banner` : null,
    };
  }

  async listAll() {
    const rows = await this.db
      .select()
      .from(adPlacements)
      .orderBy(desc(adPlacements.createdAt));
    return rows.map((r) => this.serializeAd(r));
  }

  async listActivePublic(placement?: string) {
    const now = new Date();
    const companyProfilePlacements = [
      'COMPANY_PROFILE_HERO',
      'COMPANY_PROFILE_FOOTER',
      'HOME_HERO', // legacy
    ];

    let placementFilter;
    if (placement === 'COMPANY_PROFILE_HERO') {
      placementFilter = or(
        isNull(adPlacements.placement),
        inArray(adPlacements.placement, ['COMPANY_PROFILE_HERO', 'HOME_HERO']),
      );
    } else if (placement === 'COMPANY_PROFILE_FOOTER') {
      placementFilter = eq(adPlacements.placement, 'COMPANY_PROFILE_FOOTER');
    } else {
      placementFilter = or(
        isNull(adPlacements.placement),
        inArray(adPlacements.placement, companyProfilePlacements),
      );
    }

    const rows = await this.db
      .select()
      .from(adPlacements)
      .where(
        and(
          eq(adPlacements.status, 'ACTIVE'),
          placementFilter,
          or(isNull(adPlacements.startsAt), lte(adPlacements.startsAt, now)),
          or(isNull(adPlacements.endsAt), gt(adPlacements.endsAt, now)),
        ),
      )
      .orderBy(adPlacements.sortOrder);
    return rows.map((r) => this.serializeAd(r));
  }

  async readBannerFile(id: string) {
    const [row] = await this.db
      .select()
      .from(adPlacements)
      .where(eq(adPlacements.id, id))
      .limit(1);
    if (!row?.bannerImagePath) throw new NotFoundException();
    const data = await readFile(row.bannerImagePath);
    const ext = row.bannerImagePath.split('.').pop()?.toLowerCase();
    const mime =
      ext === 'png'
        ? 'image/png'
        : ext === 'webp'
          ? 'image/webp'
          : 'image/jpeg';
    return { data, mime };
  }

  async uploadBannerImage(
    id: string,
    file: { buffer: Buffer; mimetype: string; size?: number },
  ) {
    const maxBytes = 2.5 * 1024 * 1024;
    if (file.size && file.size > maxBytes) {
      throw new BadRequestException('Ukuran banner maksimal 2,5 MB');
    }

    const [existing] = await this.db
      .select({ id: adPlacements.id })
      .from(adPlacements)
      .where(eq(adPlacements.id, id))
      .limit(1);
    if (!existing) throw new NotFoundException();

    const compressed = await compressUploadedImage(file, {
      maxEdge: 1920,
      quality: 85,
    });
    const dir = join(this.uploadRoot(), 'ads', id);
    await mkdir(dir, { recursive: true });
    const filePath = join(
      dir,
      `banner-${randomUUID()}.${compressed.extension}`,
    );
    await writeFile(filePath, compressed.buffer);

    const [row] = await this.db
      .update(adPlacements)
      .set({ bannerImagePath: filePath, updatedAt: new Date() })
      .where(eq(adPlacements.id, id))
      .returning();
    return this.serializeAd(row);
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
        placement: dto.placement ?? 'COMPANY_PROFILE_HERO',
      })
      .returning();
    return this.serializeAd(row);
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
    if (dto.placement !== undefined) patch.placement = dto.placement;

    const [row] = await this.db
      .update(adPlacements)
      .set(patch)
      .where(eq(adPlacements.id, id))
      .returning();
    if (!row) throw new NotFoundException();
    return this.serializeAd(row);
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
        dto.priceAmount ?? (await this.pricing.getAdPlacementPriceIdr()),
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

    const result = await this.payments.finalizeCheckout(payment, {
      orderId,
      customerEmail: user.email,
      customerName: user.publicLoginId,
      itemName: 'Iklan WorkRecord',
      baseAmount: amount,
      manualBankAccountId: dto.manualBankAccountId,
    });

    return { adId: ad.id, ...result };
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
