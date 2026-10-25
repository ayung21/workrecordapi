import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { asc, desc, eq } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import { adPricingPackages, platformPricing } from '../database/schema';
import { AdPlacementSlot, adPlacementSlots } from '../database/enums';

const SERVICE_FEES_KEY = 'service_fees';
const MANUAL_PAYMENT_BANK_KEY = 'manual_payment_bank';

export type ManualPaymentBankAccount = {
  id: string;
  bankName: string;
  accountNumber: string;
  accountHolder: string;
  label?: string;
};

export type ServiceFees = {
  /** Blacklist atau sanggahan — hanya untuk karyawan/pekerja, bukan PT. */
  sanggahanKaryawanIdr: number;
  /** Checkout iklan PT tanpa paket — fallback PRICE_AD_PLACEMENT. */
  adPlacementIdr: number;
};

type LegacyServiceFeesJson = Partial<
  ServiceFees & { disputeIdr?: number; blacklistIdr?: number }
>;

function resolveSanggahanKaryawanIdr(
  raw: LegacyServiceFeesJson | undefined,
  fallback: number,
): number {
  if (raw?.sanggahanKaryawanIdr != null) {
    return Number(raw.sanggahanKaryawanIdr);
  }
  if (raw?.blacklistIdr != null) return Number(raw.blacklistIdr);
  if (raw?.disputeIdr != null) return Number(raw.disputeIdr);
  return fallback;
}

function resolveAdPlacementIdr(
  raw: LegacyServiceFeesJson | undefined,
  fallback: number,
): number {
  if (raw?.adPlacementIdr != null) return Number(raw.adPlacementIdr);
  return fallback;
}

@Injectable()
export class PricingService {
  constructor(
    private readonly database: DatabaseService,
    private readonly config: ConfigService,
  ) {}

  private get db() {
    return this.database.db;
  }

  private envFees(): ServiceFees {
    const base = Number(
      this.config.get('PRICE_BLACKLIST') ??
        this.config.get('PRICE_DISPUTE', 150000),
    );
    const adPlacementIdr = Number(
      this.config.get('PRICE_AD_PLACEMENT', 500000),
    );
    return { sanggahanKaryawanIdr: base, adPlacementIdr };
  }

  async getServiceFees(): Promise<ServiceFees> {
    const [row] = await this.db
      .select()
      .from(platformPricing)
      .where(eq(platformPricing.key, SERVICE_FEES_KEY))
      .limit(1);
    const env = this.envFees();
    if (!row?.valueJson) return env;
    const v = row.valueJson as LegacyServiceFeesJson;
    return {
      sanggahanKaryawanIdr: resolveSanggahanKaryawanIdr(
        v,
        env.sanggahanKaryawanIdr,
      ),
      adPlacementIdr: resolveAdPlacementIdr(v, env.adPlacementIdr),
    };
  }

  async setServiceFees(
    patch: LegacyServiceFeesJson & Partial<ServiceFees>,
    updatedByUserId: string,
  ): Promise<ServiceFees> {
    const current = await this.getServiceFees();
    const sanggahanCandidate =
      patch.sanggahanKaryawanIdr ??
      patch.blacklistIdr ??
      patch.disputeIdr;
    const next: ServiceFees = {
      sanggahanKaryawanIdr: Number(
        sanggahanCandidate ?? current.sanggahanKaryawanIdr,
      ),
      adPlacementIdr: Number(
        patch.adPlacementIdr ?? current.adPlacementIdr,
      ),
    };
    if (next.sanggahanKaryawanIdr < 0 || next.adPlacementIdr < 0) {
      throw new BadRequestException('Harga tidak boleh negatif');
    }
    await this.db
      .insert(platformPricing)
      .values({
        key: SERVICE_FEES_KEY,
        valueJson: next,
        updatedByUserId,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: platformPricing.key,
        set: {
          valueJson: next,
          updatedByUserId,
          updatedAt: new Date(),
        },
      });
    return next;
  }

  /** ID tetap untuk fallback .env (bukan rekening dari DB). */
  private static readonly ENV_FALLBACK_ACCOUNT_ID =
    '00000000-0000-4000-8000-000000000001';

  private envManualPaymentAccounts(): ManualPaymentBankAccount[] {
    return [
      {
        id: PricingService.ENV_FALLBACK_ACCOUNT_ID,
        bankName: this.config.get<string>('MANUAL_PAYMENT_BANK_NAME', 'BCA'),
        accountNumber: this.config.get<string>(
          'MANUAL_PAYMENT_ACCOUNT_NUMBER',
          '0000000000',
        ),
        accountHolder: this.config.get<string>(
          'MANUAL_PAYMENT_ACCOUNT_HOLDER',
          'PT WorkRecord',
        ),
      },
    ];
  }

  private normalizeManualPaymentStored(
    raw: unknown,
  ): ManualPaymentBankAccount[] {
    const env = this.envManualPaymentAccounts();
    if (!raw || typeof raw !== 'object') return env;
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.accounts)) {
      const accounts = obj.accounts
        .map((a) => this.sanitizeManualPaymentAccount(a))
        .filter(Boolean) as ManualPaymentBankAccount[];
      return accounts.length > 0 ? accounts : env;
    }
    if (obj.bankName && obj.accountNumber) {
      return [
        this.sanitizeManualPaymentAccount({
          id: randomUUID(),
          ...obj,
        })!,
      ];
    }
    return env;
  }

  private sanitizeManualPaymentAccount(
    raw: unknown,
  ): ManualPaymentBankAccount | null {
    if (!raw || typeof raw !== 'object') return null;
    const v = raw as Record<string, unknown>;
    const bankName = String(v.bankName ?? '').trim();
    const accountNumber = String(v.accountNumber ?? '').replace(/\s/g, '');
    const accountHolder = String(v.accountHolder ?? '').trim();
    if (!bankName || !accountNumber || !accountHolder) return null;
    const label = v.label != null ? String(v.label).trim() : undefined;
    const rawId = typeof v.id === 'string' ? v.id.trim() : '';
    const uuidOk =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        rawId,
      );
    return {
      id: uuidOk ? rawId : randomUUID(),
      bankName,
      accountNumber,
      accountHolder,
      label: label || undefined,
    };
  }

  async getManualPaymentBanks(): Promise<ManualPaymentBankAccount[]> {
    const [row] = await this.db
      .select()
      .from(platformPricing)
      .where(eq(platformPricing.key, MANUAL_PAYMENT_BANK_KEY))
      .limit(1);
    if (!row?.valueJson) return this.envManualPaymentAccounts();
    return this.normalizeManualPaymentStored(row.valueJson);
  }

  async resolveManualPaymentBank(
    accountId?: string,
  ): Promise<ManualPaymentBankAccount> {
    const accounts = await this.getManualPaymentBanks();
    if (accounts.length === 0) {
      throw new BadRequestException('Rekening pembayaran belum dikonfigurasi');
    }
    if (accountId) {
      const found = accounts.find((a) => a.id === accountId);
      if (!found) {
        throw new BadRequestException('Rekening tujuan transfer tidak valid');
      }
      return found;
    }
    if (accounts.length === 1) return accounts[0];
    throw new BadRequestException('Pilih rekening tujuan transfer');
  }

  async setManualPaymentBanks(
    input: Array<{
      id?: string;
      label?: string;
      bankName: string;
      accountNumber: string;
      accountHolder: string;
    }>,
    updatedByUserId: string,
  ): Promise<ManualPaymentBankAccount[]> {
    if (!input.length) {
      throw new BadRequestException('Minimal satu rekening');
    }
    const next: ManualPaymentBankAccount[] = [];
    const numbers = new Set<string>();
    for (const row of input) {
      const acc = this.sanitizeManualPaymentAccount({
        id: row.id ?? randomUUID(),
        label: row.label,
        bankName: row.bankName,
        accountNumber: row.accountNumber,
        accountHolder: row.accountHolder,
      });
      if (!acc) {
        throw new BadRequestException('Data rekening tidak lengkap');
      }
      if (!/^\d+$/.test(acc.accountNumber)) {
        throw new BadRequestException(
          `Nomor rekening ${acc.accountNumber} hanya boleh angka`,
        );
      }
      if (numbers.has(acc.accountNumber)) {
        throw new BadRequestException('Nomor rekening duplikat');
      }
      numbers.add(acc.accountNumber);
      next.push(acc);
    }
    await this.db
      .insert(platformPricing)
      .values({
        key: MANUAL_PAYMENT_BANK_KEY,
        valueJson: { accounts: next },
        updatedByUserId,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: platformPricing.key,
        set: {
          valueJson: { accounts: next },
          updatedByUserId,
          updatedAt: new Date(),
        },
      });
    return next;
  }

  async getSanggahanKaryawanPriceIdr() {
    return (await this.getServiceFees()).sanggahanKaryawanIdr;
  }

  /** Pengaduan/sanggahan pekerja — tarif sama dengan blacklist karyawan. */
  async getDisputePriceIdr() {
    return this.getSanggahanKaryawanPriceIdr();
  }

  /** Blacklist karyawan oleh PT — bukan blacklist perusahaan. */
  async getBlacklistPriceIdr() {
    return this.getSanggahanKaryawanPriceIdr();
  }

  async getAdPlacementPriceIdr() {
    return (await this.getServiceFees()).adPlacementIdr;
  }

  listAdPackages(includeInactive = false) {
    if (includeInactive) {
      return this.db
        .select()
        .from(adPricingPackages)
        .orderBy(asc(adPricingPackages.sortOrder), desc(adPricingPackages.createdAt));
    }
    return this.db
      .select()
      .from(adPricingPackages)
      .where(eq(adPricingPackages.isActive, true))
      .orderBy(asc(adPricingPackages.sortOrder), desc(adPricingPackages.createdAt));
  }

  private assertPlacement(placement: string): AdPlacementSlot {
    if (!(adPlacementSlots as readonly string[]).includes(placement)) {
      throw new BadRequestException('Posisi iklan tidak valid');
    }
    return placement as AdPlacementSlot;
  }

  async createAdPackage(input: {
    code: string;
    label: string;
    placement: string;
    durationDays: number;
    priceIdr: number;
    description?: string;
    validFrom?: string | null;
    validUntil?: string | null;
    isActive?: boolean;
    sortOrder?: number;
  }) {
    const placement = this.assertPlacement(input.placement);
    if (input.durationDays < 1) {
      throw new BadRequestException('Durasi minimal 1 hari');
    }
    const [row] = await this.db
      .insert(adPricingPackages)
      .values({
        code: input.code.trim().toUpperCase(),
        label: input.label.trim(),
        placement,
        durationDays: input.durationDays,
        priceIdr: String(input.priceIdr),
        description: input.description?.trim(),
        validFrom: input.validFrom ? new Date(input.validFrom) : null,
        validUntil: input.validUntil ? new Date(input.validUntil) : null,
        isActive: input.isActive ?? true,
        sortOrder: input.sortOrder ?? 0,
      })
      .returning();
    return row;
  }

  async updateAdPackage(
    id: string,
    patch: Partial<{
      label: string;
      placement: string;
      durationDays: number;
      priceIdr: number;
      description: string | null;
      validFrom: string | null;
      validUntil: string | null;
      isActive: boolean;
      sortOrder: number;
    }>,
  ) {
    const values: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.label !== undefined) values.label = patch.label.trim();
    if (patch.placement !== undefined) {
      values.placement = this.assertPlacement(patch.placement);
    }
    if (patch.durationDays !== undefined) values.durationDays = patch.durationDays;
    if (patch.priceIdr !== undefined) values.priceIdr = String(patch.priceIdr);
    if (patch.description !== undefined) {
      values.description = patch.description?.trim() ?? null;
    }
    if (patch.validFrom !== undefined) {
      values.validFrom = patch.validFrom ? new Date(patch.validFrom) : null;
    }
    if (patch.validUntil !== undefined) {
      values.validUntil = patch.validUntil ? new Date(patch.validUntil) : null;
    }
    if (patch.isActive !== undefined) values.isActive = patch.isActive;
    if (patch.sortOrder !== undefined) values.sortOrder = patch.sortOrder;

    const [row] = await this.db
      .update(adPricingPackages)
      .set(values)
      .where(eq(adPricingPackages.id, id))
      .returning();
    if (!row) throw new NotFoundException('Paket iklan tidak ditemukan');
    return row;
  }

  async resolveAdPackageForPurchase(id: string, at = new Date()) {
    const [pkg] = await this.db
      .select()
      .from(adPricingPackages)
      .where(eq(adPricingPackages.id, id))
      .limit(1);
    if (!pkg || !pkg.isActive) {
      throw new BadRequestException('Paket iklan tidak tersedia');
    }
    if (pkg.validFrom && pkg.validFrom > at) {
      throw new BadRequestException('Paket iklan belum berlaku');
    }
    if (pkg.validUntil && pkg.validUntil < at) {
      throw new BadRequestException('Paket iklan sudah tidak berlaku');
    }
    return pkg;
  }

  async listPurchasableAdPackages(at = new Date()) {
    const rows = await this.listAdPackages(false);
    return rows.filter((pkg) => {
      if (pkg.validFrom && pkg.validFrom > at) return false;
      if (pkg.validUntil && pkg.validUntil < at) return false;
      return true;
    });
  }

  placementLabel(slot: string) {
    const map: Record<string, string> = {
      COMPANY_PROFILE_HERO:
        'Company profile — banner carousel (atas halaman depan)',
      COMPANY_PROFILE_FOOTER:
        'Company profile — strip promosi (bawah halaman depan)',
      HOME_HERO: 'Company profile — banner (slot lama)',
      EXPLORE_SIDEBAR: 'Legacy — tidak dipakai',
      EXPLORE_INLINE: 'Legacy — tidak dipakai',
      LOGIN_BANNER: 'Legacy — tidak dipakai',
    };
    return map[slot] ?? slot;
  }

  async getPublicCatalog() {
    const fees = await this.getServiceFees();
    const adPackages = await this.listPurchasableAdPackages();
    const idr = fees.sanggahanKaryawanIdr;
    const adIdr = fees.adPlacementIdr;
    return {
      currency: 'IDR',
      fees: {
        sanggahanKaryawanIdr: idr,
        adPlacementIdr: adIdr,
        /** Alias kompatibilitas klien lama */
        blacklistIdr: idr,
        disputeIdr: idr,
        sanggahanIdr: idr,
      },
      adPackages: adPackages.map((p) => ({
        id: p.id,
        code: p.code,
        label: p.label,
        placement: p.placement,
        placementLabel: this.placementLabel(p.placement),
        durationDays: p.durationDays,
        priceIdr: Number(p.priceIdr),
        description: p.description,
        validFrom: p.validFrom?.toISOString() ?? null,
        validUntil: p.validUntil?.toISOString() ?? null,
      })),
    };
  }
}
