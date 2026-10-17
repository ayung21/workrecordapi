import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import {
  companies,
  employeeBlacklists,
  employeeProfiles,
  employeeRecords,
  payments,
  recordChangeRequests,
  users,
} from '../database/schema';
import { JwtPayload } from '../auth/types/jwt-payload';
import { PaymentsService } from '../payments/payments.service';
import { AuditService } from '../audit/audit.service';
import { AccessService } from '../access/access.service';

@Injectable()
export class BlacklistsService {
  constructor(
    private readonly database: DatabaseService,
    @Inject(forwardRef(() => PaymentsService))
    private readonly payments: PaymentsService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
  ) {}

  private get db() {
    return this.database.db;
  }

  private normalizeNik(nik: string): string {
    return nik.replace(/\D/g, '');
  }

  private async assertCanBlacklistRecord(
    companyId: string,
    employeeRecordId: string,
    exceptChangeRequestId?: string,
  ) {
    const record = await this.db.query.employeeRecords.findFirst({
      where: and(
        eq(employeeRecords.id, employeeRecordId),
        eq(employeeRecords.companyId, companyId),
      ),
    });
    if (!record) throw new NotFoundException('Record karyawan tidak ditemukan');

    const existing = await this.db.query.employeeBlacklists.findFirst({
      where: and(
        eq(employeeBlacklists.companyId, companyId),
        eq(employeeBlacklists.employeeRecordId, employeeRecordId),
        eq(employeeBlacklists.status, 'ACTIVE'),
      ),
    });
    if (existing) {
      throw new BadRequestException(
        'Karyawan ini sudah dalam status blacklist aktif',
      );
    }

    const pending = await this.db.query.recordChangeRequests.findFirst({
      where: and(
        eq(recordChangeRequests.companyId, companyId),
        eq(recordChangeRequests.employeeRecordId, employeeRecordId),
        eq(recordChangeRequests.action, 'BLACKLIST'),
        eq(recordChangeRequests.status, 'PENDING_APPROVAL'),
      ),
    });
    if (pending && pending.id !== exceptChangeRequestId) {
      throw new BadRequestException(
        'Sudah ada pengajuan blacklist yang menunggu persetujuan pimpinan',
      );
    }
  }

  private async isLeadershipActor(user: JwtPayload): Promise<boolean> {
    if (user.roleCode === 'OWNER') return true;
    const dbUser = await this.db.query.users.findFirst({
      where: eq(users.id, user.sub),
    });
    return dbUser?.accountType === 'LEADERSHIP';
  }

  async checkout(
    user: JwtPayload,
    input: {
      employeeRecordId: string;
      note: string;
      email: string;
      voucherCode?: string;
    },
  ) {
    if (!user.companyId) {
      throw new ForbiddenException('Hanya akun perusahaan');
    }
    await this.access.assertPortalCompanyActive(user);
    const note = input.note?.trim();
    if (!note || note.length < 10) {
      throw new BadRequestException(
        'Catatan alasan blacklist wajib diisi (min. 10 karakter)',
      );
    }

    await this.assertCanBlacklistRecord(user.companyId, input.employeeRecordId);

    const leadership = await this.isLeadershipActor(user);

    if (!leadership) {
      const [req] = await this.db
        .insert(recordChangeRequests)
        .values({
          companyId: user.companyId,
          employeeRecordId: input.employeeRecordId,
          action: 'BLACKLIST',
          status: 'PENDING_APPROVAL',
          payload: {
            employeeRecordId: input.employeeRecordId,
            note,
            email: input.email,
            voucherCode: input.voucherCode,
          },
          requestedById: user.sub,
        })
        .returning();
      await this.audit.log({
        action: 'RECORD_UPDATE',
        actorUserId: user.sub,
        companyId: user.companyId,
        entityType: 'RecordChangeRequest',
        entityId: req.id,
        metadata: {
          action: 'BLACKLIST',
          employeeRecordId: input.employeeRecordId,
          pendingApproval: true,
        },
      });
      return {
        mode: 'PENDING_APPROVAL' as const,
        request: req,
      };
    }

    const payment = await this.payments.createBlacklistPayment({
      userId: user.sub,
      companyId: user.companyId,
      employeeRecordId: input.employeeRecordId,
      email: input.email,
      note,
      voucherCode: input.voucherCode,
    });
    return {
      mode: 'CHECKOUT' as const,
      ...payment,
    };
  }

  async checkoutApprovedRequest(
    leader: JwtPayload,
    requestId: string,
    input: { email: string; voucherCode?: string },
  ) {
    if (!leader.companyId) {
      throw new ForbiddenException('Hanya akun perusahaan');
    }
    await this.access.assertPortalCompanyActive(leader);
    if (!(await this.isLeadershipActor(leader))) {
      throw new ForbiddenException(
        'Hanya pimpinan yang dapat menyetujui dan membayar blacklist',
      );
    }

    const req = await this.db.query.recordChangeRequests.findFirst({
      where: eq(recordChangeRequests.id, requestId),
    });
    if (!req || req.companyId !== leader.companyId) {
      throw new NotFoundException();
    }
    if (req.action !== 'BLACKLIST' || req.status !== 'PENDING_APPROVAL') {
      throw new BadRequestException('Pengajuan blacklist tidak valid');
    }

    const payload = req.payload as {
      employeeRecordId?: string;
      note?: string;
      voucherCode?: string;
    };
    const employeeRecordId = payload.employeeRecordId ?? req.employeeRecordId;
    const note = payload.note?.trim();
    if (!employeeRecordId || !note) {
      throw new BadRequestException('Payload pengajuan tidak lengkap');
    }

    await this.assertCanBlacklistRecord(
      leader.companyId,
      employeeRecordId,
      requestId,
    );

    const payment = await this.payments.createBlacklistPayment({
      userId: leader.sub,
      companyId: leader.companyId,
      employeeRecordId,
      email: input.email,
      note,
      voucherCode: input.voucherCode ?? payload.voucherCode,
      changeRequestId: requestId,
    });

    return {
      mode: 'CHECKOUT' as const,
      requestId,
      ...payment,
    };
  }

  async rejectRequest(
    leader: JwtPayload,
    requestId: string,
    rejectionReason: string,
  ) {
    const req = await this.db.query.recordChangeRequests.findFirst({
      where: eq(recordChangeRequests.id, requestId),
    });
    if (!req || req.companyId !== leader.companyId) {
      throw new NotFoundException();
    }
    if (req.action !== 'BLACKLIST' || req.status !== 'PENDING_APPROVAL') {
      throw new BadRequestException('Pengajuan blacklist tidak valid');
    }
    if (!(await this.isLeadershipActor(leader))) {
      throw new ForbiddenException('Hanya pimpinan yang dapat menolak');
    }
    const reason = rejectionReason.trim();
    if (reason.length < 5) {
      throw new BadRequestException(
        'Alasan penolakan wajib diisi (min. 5 karakter)',
      );
    }

    const [updated] = await this.db
      .update(recordChangeRequests)
      .set({
        status: 'REJECTED',
        rejectionReason: reason,
        approvedById: leader.sub,
        updatedAt: new Date(),
      })
      .where(eq(recordChangeRequests.id, requestId))
      .returning();

    await this.audit.log({
      action: 'RECORD_CHANGE_REJECTED',
      actorUserId: leader.sub,
      companyId: leader.companyId,
      entityType: 'RecordChangeRequest',
      entityId: requestId,
      metadata: { action: 'BLACKLIST', rejectionReason: reason },
    });

    return updated;
  }

  async finalizeFromPayment(paymentId: string) {
    const payment = await this.db.query.payments.findFirst({
      where: eq(payments.id, paymentId),
    });
    if (!payment || payment.type !== 'BLACKLIST' || payment.status !== 'PAID') {
      throw new BadRequestException('Pembayaran blacklist tidak valid');
    }

    const used = await this.db.query.employeeBlacklists.findFirst({
      where: eq(employeeBlacklists.paymentId, paymentId),
    });
    if (used) return used;

    const meta = payment.metadata as {
      employeeRecordId?: string;
      note?: string;
      changeRequestId?: string;
    } | null;
    const employeeRecordId = meta?.employeeRecordId;
    const note = meta?.note?.trim();
    if (!employeeRecordId || !note) {
      throw new BadRequestException('Metadata pembayaran tidak lengkap');
    }

    const record = await this.db.query.employeeRecords.findFirst({
      where: eq(employeeRecords.id, employeeRecordId),
    });
    if (!record || record.companyId !== payment.companyId) {
      throw new BadRequestException('Record tidak sesuai pembayaran');
    }

    const profileId = record.employeeProfileId;
    if (!profileId) {
      throw new BadRequestException(
        'Profil karyawan (NIK KTP) tidak ditemukan pada record',
      );
    }
    const profile = await this.db.query.employeeProfiles.findFirst({
      where: eq(employeeProfiles.id, profileId),
    });
    const nik = profile?.nationalIdNumber;
    if (!nik) {
      throw new BadRequestException('NIK KTP tidak ditemukan pada profil karyawan');
    }
    const normalizedNik = this.normalizeNik(nik);

    const [blacklist] = await this.db
      .insert(employeeBlacklists)
      .values({
        companyId: payment.companyId!,
        employeeProfileId: profileId,
        employeeRecordId,
        nationalIdNumber: normalizedNik,
        note,
        paymentId,
        status: 'ACTIVE',
        createdByUserId: payment.userId,
      })
      .returning();

    await this.audit.log({
      action: 'DISPUTE_CREATED',
      actorUserId: payment.userId ?? undefined,
      companyId: payment.companyId ?? undefined,
      entityType: 'EmployeeBlacklist',
      entityId: blacklist.id,
      metadata: { employeeRecordId },
    });

    if (meta?.changeRequestId) {
      await this.db
        .update(recordChangeRequests)
        .set({
          status: 'APPROVED',
          approvedById: payment.userId ?? undefined,
          appliedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(recordChangeRequests.id, meta.changeRequestId));
      await this.audit.log({
        action: 'RECORD_CHANGE_APPROVED',
        actorUserId: payment.userId ?? undefined,
        companyId: payment.companyId ?? undefined,
        entityType: 'RecordChangeRequest',
        entityId: meta.changeRequestId,
        metadata: { action: 'BLACKLIST', employeeRecordId },
      });
    }

    return blacklist;
  }

  async cancel(user: JwtPayload, blacklistId: string) {
    if (!user.companyId) throw new ForbiddenException();
    await this.access.assertPortalCompanyActive(user);
    const row = await this.db.query.employeeBlacklists.findFirst({
      where: eq(employeeBlacklists.id, blacklistId),
    });
    if (!row || row.companyId !== user.companyId) {
      throw new NotFoundException();
    }
    if (row.status !== 'ACTIVE') {
      throw new BadRequestException('Blacklist sudah tidak aktif');
    }

    const [updated] = await this.db
      .update(employeeBlacklists)
      .set({
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancelledByUserId: user.sub,
        updatedAt: new Date(),
      })
      .where(eq(employeeBlacklists.id, blacklistId))
      .returning();

    await this.audit.log({
      action: 'DISPUTE_STATUS_UPDATE',
      actorUserId: user.sub,
      companyId: user.companyId,
      entityType: 'EmployeeBlacklist',
      entityId: blacklistId,
      metadata: { status: 'CANCELLED' },
    });

    return updated;
  }

  async listForCompany(companyId: string) {
    return this.db
      .select()
      .from(employeeBlacklists)
      .where(eq(employeeBlacklists.companyId, companyId))
      .orderBy(desc(employeeBlacklists.createdAt));
  }

  /** Sanggahan aktif pada satu record — tanpa alasan (untuk lintas perusahaan). */
  async getActiveDisputeForRecord(recordId: string) {
    const row = await this.db.query.employeeBlacklists.findFirst({
      where: and(
        eq(employeeBlacklists.employeeRecordId, recordId),
        eq(employeeBlacklists.status, 'ACTIVE'),
      ),
    });
    if (!row) return null;
    const company = await this.db.query.companies.findFirst({
      where: eq(companies.id, row.companyId),
    });
    return {
      companyId: row.companyId,
      companyName: company?.name ?? 'Perusahaan',
      employeeRecordId: row.employeeRecordId,
    };
  }

  /** Semua perusahaan yang punya sanggahan aktif pada profil — tanpa catatan alasan. */
  async listActiveDisputeSources(
    profileId: string | null,
    nationalId: string | null,
  ) {
    const nik = nationalId ? this.normalizeNik(nationalId) : null;
    if (!profileId && !nik) return [];

    const activeRows = await this.db
      .select({
        companyId: employeeBlacklists.companyId,
        companyName: companies.name,
        employeeRecordId: employeeBlacklists.employeeRecordId,
      })
      .from(employeeBlacklists)
      .innerJoin(companies, eq(employeeBlacklists.companyId, companies.id))
      .where(
        and(
          eq(employeeBlacklists.status, 'ACTIVE'),
          profileId
            ? eq(employeeBlacklists.employeeProfileId, profileId)
            : eq(employeeBlacklists.nationalIdNumber, nik!),
        ),
      );

    const seen = new Set<string>();
    const out: {
      companyId: string;
      companyName: string;
      employeeRecordId: string | null;
    }[] = [];
    for (const row of activeRows) {
      if (seen.has(row.companyId)) continue;
      seen.add(row.companyId);
      out.push({
        companyId: row.companyId,
        companyName: row.companyName,
        employeeRecordId: row.employeeRecordId,
      });
    }
    return out;
  }

  /** Flags untuk tampilan lintas perusahaan — note hanya untuk pemilik blacklist. */
  async resolveVisibility(
    profileId: string | null,
    nationalId: string | null,
    viewerCompanyId?: string | null,
  ) {
    const nik = nationalId ? this.normalizeNik(nationalId) : null;
    if (!profileId && !nik) {
      return {
        hasBlacklist: false,
        blacklistedByViewerCompany: false,
        blacklistNote: null as string | null,
      };
    }

    const activeRows = await this.db
      .select()
      .from(employeeBlacklists)
      .where(
        and(
          eq(employeeBlacklists.status, 'ACTIVE'),
          profileId
            ? eq(employeeBlacklists.employeeProfileId, profileId)
            : eq(employeeBlacklists.nationalIdNumber, nik!),
        ),
      );

    const hasBlacklist = activeRows.length > 0;
    const own = viewerCompanyId
      ? activeRows.find((r) => r.companyId === viewerCompanyId)
      : undefined;

    return {
      hasBlacklist,
      blacklistedByViewerCompany: Boolean(own),
      blacklistNote: own?.note ?? null,
    };
  }

  async spendReport(companyId: string) {
    const rows = await this.listForCompany(companyId);
    const paymentIds = rows.map((r) => r.paymentId);
    let totalSpent = 0;
    if (paymentIds.length) {
      const paid = await this.db
        .select()
        .from(payments)
        .where(
          and(eq(payments.status, 'PAID'), inArray(payments.id, paymentIds)),
        );
      for (const p of paid) totalSpent += Number(p.amount);
    }
    return {
      totalSpent,
      currency: 'IDR',
      blacklists: rows.map((r) => ({
        id: r.id,
        status: r.status,
        note: r.note,
        nationalIdNumber: r.nationalIdNumber,
        employeeRecordId: r.employeeRecordId,
        createdAt: r.createdAt,
        paymentId: r.paymentId,
      })),
    };
  }
}
