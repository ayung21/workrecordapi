import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { PaymentType, VoucherAppliesTo } from '../database/enums';
import { DatabaseService } from '../database/database.service';
import {
  companies,
  payments,
  voucherCompanies,
  voucherRedemptions,
  vouchers,
} from '../database/schema';
import { CreateVoucherDto } from './dto/create-voucher.dto';
import { UpdateVoucherDto } from './dto/update-voucher.dto';

export type VoucherQuote = {
  voucherId: string;
  code: string;
  originalAmount: number;
  finalAmount: number;
  discountAmount: number;
};

export type VoucherListItem = Awaited<
  ReturnType<VouchersService['list']>
>[number];

@Injectable()
export class VouchersService {
  constructor(private readonly database: DatabaseService) {}

  private get db() {
    return this.database.db;
  }

  async list() {
    const rows = await this.db
      .select()
      .from(vouchers)
      .orderBy(desc(vouchers.createdAt));

    const links = await this.db
      .select({
        voucherId: voucherCompanies.voucherId,
        companyId: voucherCompanies.companyId,
        companyName: companies.name,
      })
      .from(voucherCompanies)
      .innerJoin(companies, eq(voucherCompanies.companyId, companies.id));

    const companiesByVoucher = new Map<
      string,
      { id: string; name: string }[]
    >();
    for (const link of links) {
      const list = companiesByVoucher.get(link.voucherId) ?? [];
      list.push({ id: link.companyId, name: link.companyName });
      companiesByVoucher.set(link.voucherId, list);
    }

    return rows.map((row) => {
      const eligible = companiesByVoucher.get(row.id) ?? [];
      return {
        ...row,
        companyIds: eligible.map((c) => c.id),
        companies: eligible,
      };
    });
  }

  private async syncVoucherCompanies(voucherId: string, companyIds: string[]) {
    await this.db
      .delete(voucherCompanies)
      .where(eq(voucherCompanies.voucherId, voucherId));
    if (!companyIds.length) return;
    await this.db.insert(voucherCompanies).values(
      companyIds.map((companyId) => ({
        voucherId,
        companyId,
      })),
    );
  }

  async create(dto: CreateVoucherDto, createdByUserId: string) {
    const code = dto.code.trim().toUpperCase();
    const eligibilityMode = dto.eligibilityMode ?? 'ALL';

    if (eligibilityMode === 'SELECTED') {
      if (!dto.companyIds?.length) {
        throw new BadRequestException(
          'Pilih minimal satu perusahaan untuk voucher terbatas.',
        );
      }
    }

    const [row] = await this.db
      .insert(vouchers)
      .values({
        code,
        title: dto.title.trim(),
        appliesTo: dto.appliesTo,
        benefitType: dto.benefitType,
        benefitValue: String(dto.benefitValue ?? 0),
        maxUses: dto.maxUses ?? null,
        maxUsesPerCompany:
          eligibilityMode === 'ALL' ? (dto.maxUsesPerCompany ?? null) : null,
        eligibilityMode,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        isActive: dto.isActive ?? true,
        createdByUserId,
      })
      .returning();

    if (eligibilityMode === 'SELECTED' && dto.companyIds?.length) {
      await this.syncVoucherCompanies(row.id, dto.companyIds);
    }

    const [full] = await this.list().then((all) =>
      all.filter((v) => v.id === row.id),
    );
    return full ?? row;
  }

  async update(id: string, dto: UpdateVoucherDto) {
    const [existing] = await this.db
      .select()
      .from(vouchers)
      .where(eq(vouchers.id, id))
      .limit(1);
    if (!existing) throw new NotFoundException();

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (dto.title !== undefined) patch.title = dto.title.trim();
    if (dto.appliesTo !== undefined) patch.appliesTo = dto.appliesTo;
    if (dto.benefitType !== undefined) patch.benefitType = dto.benefitType;
    if (dto.benefitValue !== undefined) {
      patch.benefitValue = String(dto.benefitValue);
    }
    if (dto.maxUses !== undefined) patch.maxUses = dto.maxUses;
    if (dto.expiresAt !== undefined) {
      patch.expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    }
    if (dto.isActive !== undefined) patch.isActive = dto.isActive;

    const nextMode = dto.eligibilityMode ?? existing.eligibilityMode ?? 'ALL';
    if (dto.eligibilityMode !== undefined) {
      patch.eligibilityMode = dto.eligibilityMode;
    }

    if (dto.maxUsesPerCompany !== undefined) {
      patch.maxUsesPerCompany = dto.maxUsesPerCompany;
    } else if (dto.eligibilityMode === 'SELECTED') {
      patch.maxUsesPerCompany = null;
    }

    if (nextMode === 'SELECTED' && dto.companyIds !== undefined) {
      if (!dto.companyIds.length) {
        throw new BadRequestException(
          'Pilih minimal satu perusahaan untuk voucher terbatas.',
        );
      }
    }

    const [row] = await this.db
      .update(vouchers)
      .set(patch)
      .where(eq(vouchers.id, id))
      .returning();
    if (!row) throw new NotFoundException();

    if (dto.companyIds !== undefined) {
      const mode = row.eligibilityMode ?? 'ALL';
      if (mode === 'SELECTED') {
        await this.syncVoucherCompanies(id, dto.companyIds);
      } else {
        await this.db
          .delete(voucherCompanies)
          .where(eq(voucherCompanies.voucherId, id));
      }
    } else if (dto.eligibilityMode === 'ALL') {
      await this.db
        .delete(voucherCompanies)
        .where(eq(voucherCompanies.voucherId, id));
    }

    const [full] = await this.list().then((all) =>
      all.filter((v) => v.id === id),
    );
    return full ?? row;
  }

  /** Kuota dihitung dari pembayaran yang sudah PAID (bukan checkout tertunda). */
  private async countPaidRedemptions(
    voucherId: string,
    companyId?: string,
  ): Promise<number> {
    const conditions = [
      eq(voucherRedemptions.voucherId, voucherId),
      eq(payments.status, 'PAID'),
    ];
    if (companyId) {
      conditions.push(eq(voucherRedemptions.companyId, companyId));
    }
    const [{ count }] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(voucherRedemptions)
      .innerJoin(payments, eq(voucherRedemptions.paymentId, payments.id))
      .where(and(...conditions));
    return count ?? 0;
  }

  private async findByCode(code: string) {
    const [row] = await this.db
      .select()
      .from(vouchers)
      .where(eq(vouchers.code, code.trim().toUpperCase()))
      .limit(1);
    return row;
  }

  private async assertCompanyEligibility(
    row: typeof vouchers.$inferSelect,
    companyId?: string,
  ) {
    const mode = row.eligibilityMode ?? 'ALL';

    if (mode === 'SELECTED') {
      if (!companyId) {
        throw new BadRequestException(
          'Voucher hanya berlaku untuk perusahaan tertentu',
        );
      }
      const [link] = await this.db
        .select({ companyId: voucherCompanies.companyId })
        .from(voucherCompanies)
        .where(
          and(
            eq(voucherCompanies.voucherId, row.id),
            eq(voucherCompanies.companyId, companyId),
          ),
        )
        .limit(1);
      if (!link) {
        throw new BadRequestException(
          'Voucher tidak berlaku untuk perusahaan ini',
        );
      }
    }

    if (row.maxUsesPerCompany != null) {
      if (!companyId) {
        throw new BadRequestException(
          'Voucher memerlukan konteks perusahaan untuk kuota',
        );
      }
      const count = await this.countPaidRedemptions(row.id, companyId);
      if (count >= row.maxUsesPerCompany) {
        throw new BadRequestException(
          'Kuota voucher untuk perusahaan ini sudah habis',
        );
      }
    }
  }

  async quote(
    code: string,
    appliesTo: VoucherAppliesTo,
    originalAmount: number,
    companyId?: string,
  ): Promise<VoucherQuote> {
    const row = await this.findByCode(code);
    if (!row || !row.isActive) {
      throw new BadRequestException('Voucher tidak valid');
    }
    if (row.appliesTo !== appliesTo) {
      throw new BadRequestException('Voucher tidak berlaku untuk transaksi ini');
    }
    if (row.expiresAt && row.expiresAt < new Date()) {
      throw new BadRequestException('Voucher sudah kedaluwarsa');
    }
    if (row.maxUses != null) {
      const paidUses = await this.countPaidRedemptions(row.id);
      if (paidUses >= row.maxUses) {
        throw new BadRequestException('Voucher sudah habis');
      }
    }

    await this.assertCompanyEligibility(row, companyId);

    let finalAmount = originalAmount;
    if (row.benefitType === 'FREE') {
      finalAmount = 0;
    } else if (row.benefitType === 'PERCENT') {
      const pct = Number(row.benefitValue);
      finalAmount = Math.max(0, originalAmount - (originalAmount * pct) / 100);
    } else if (row.benefitType === 'FIXED') {
      finalAmount = Math.max(0, originalAmount - Number(row.benefitValue));
    }

    return {
      voucherId: row.id,
      code: row.code,
      originalAmount,
      finalAmount,
      discountAmount: originalAmount - finalAmount,
    };
  }

  async redeem(input: {
    voucherId: string;
    paymentId: string;
    userId?: string;
    companyId?: string;
  }) {
    await this.db.insert(voucherRedemptions).values(input);
    await this.db
      .update(vouchers)
      .set({
        usedCount: sql`${vouchers.usedCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(vouchers.id, input.voucherId));
  }

  /** Voucher aktif yang boleh dipakai PT (tanpa bocorkan OTP/dll.). */
  async listAvailableForCompany(
    companyId: string,
    appliesTo: VoucherAppliesTo,
  ) {
    const rows = await this.db
      .select()
      .from(vouchers)
      .where(and(eq(vouchers.isActive, true), eq(vouchers.appliesTo, appliesTo)))
      .orderBy(desc(vouchers.createdAt));

    if (!rows.length) return [];

    const links = await this.db
      .select()
      .from(voucherCompanies)
      .where(
        inArray(
          voucherCompanies.voucherId,
          rows.map((r) => r.id),
        ),
      );

    const selectedByVoucher = new Map<string, Set<string>>();
    for (const link of links) {
      const set =
        selectedByVoucher.get(link.voucherId) ?? new Set<string>();
      set.add(link.companyId);
      selectedByVoucher.set(link.voucherId, set);
    }

    const now = new Date();
    const out: {
      code: string;
      title: string;
      benefitType: string;
      benefitValue: number;
    }[] = [];

    for (const row of rows) {
      if (row.expiresAt && row.expiresAt < now) continue;
      if (row.maxUses != null) {
        const paidUses = await this.countPaidRedemptions(row.id);
        if (paidUses >= row.maxUses) continue;
      }

      const mode = row.eligibilityMode ?? 'ALL';
      if (mode === 'SELECTED') {
        const allowed = selectedByVoucher.get(row.id);
        if (!allowed?.has(companyId)) continue;
      }

      if (row.maxUsesPerCompany != null) {
        const count = await this.countPaidRedemptions(row.id, companyId);
        if (count >= row.maxUsesPerCompany) continue;
      }

      out.push({
        code: row.code,
        title: row.title,
        benefitType: row.benefitType,
        benefitValue: Number(row.benefitValue),
      });
    }

    return out;
  }

  applyToAmount(
    paymentType: PaymentType,
    amount: number,
    voucherCode?: string,
    companyId?: string,
  ): Promise<{ amount: number; voucherId?: string }> {
    const code = voucherCode?.trim().toUpperCase();
    if (!code) {
      return Promise.resolve({ amount });
    }
    const map: Partial<Record<PaymentType, VoucherAppliesTo>> = {
      BLACKLIST: 'BLACKLIST',
      DISPUTE: 'DISPUTE',
      VIEW_ACCESS: 'VIEW_ACCESS',
    };
    const appliesTo = map[paymentType];
    if (!appliesTo) {
      return Promise.resolve({ amount });
    }
    if (paymentType === 'BLACKLIST' || paymentType === 'DISPUTE') {
      return this.quoteForSanggahanKaryawan(code, amount, companyId).then(
        (q) => ({
          amount: q.finalAmount,
          voucherId: q.voucherId,
        }),
      );
    }

    return this.quote(code, appliesTo, amount, companyId).then((q) => ({
      amount: q.finalAmount,
      voucherId: q.voucherId,
    }));
  }

  /** Sanggahan karyawan (BLACKLIST) dan pengaduan pekerja (DISPUTE) memakai tarif sama. */
  async listAvailableForSanggahanKaryawan(companyId: string) {
    const blacklist = await this.listAvailableForCompany(companyId, 'BLACKLIST');
    const dispute = await this.listAvailableForCompany(companyId, 'DISPUTE');
    const seen = new Set<string>();
    const merged: typeof blacklist = [];
    for (const row of [...blacklist, ...dispute]) {
      if (seen.has(row.code)) continue;
      seen.add(row.code);
      merged.push(row);
    }
    return merged;
  }

  async quoteForSanggahanKaryawan(
    code: string,
    originalAmount: number,
    companyId?: string,
  ): Promise<VoucherQuote> {
    const normalized = code.trim().toUpperCase();
    let lastError: unknown;
    for (const appliesTo of ['BLACKLIST', 'DISPUTE'] as const) {
      try {
        return await this.quote(
          normalized,
          appliesTo,
          originalAmount,
          companyId,
        );
      } catch (err) {
        lastError = err;
      }
    }
    if (lastError instanceof Error) throw lastError;
    throw new BadRequestException('Voucher tidak valid');
  }
}
