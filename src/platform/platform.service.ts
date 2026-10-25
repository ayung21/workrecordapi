import { ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { PaymentType } from '../database/enums';
import { DatabaseService } from '../database/database.service';
import {
  adPlacements,
  auditLogs,
  companies,
  disputes,
  employeeBlacklists,
  employeeRecords,
  payments,
  users,
} from '../database/schema';
import { EmployeeRecordsService } from '../employee-records/employee-records.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../database/enums';
import { JwtPayload } from '../auth/types/jwt-payload';
import { SiteVerificationVideoService } from '../companies/site-verification-video.service';
import { PricingService } from '../pricing/pricing.service';

@Injectable()
export class PlatformService {
  constructor(
    private readonly database: DatabaseService,
    private readonly records: EmployeeRecordsService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    private readonly siteVideo: SiteVerificationVideoService,
    private readonly pricing: PricingService,
  ) {}

  private get db() {
    return this.database.db;
  }

  listAuditLogs(
    user: JwtPayload,
    opts: { action?: AuditAction; companyId?: string; limit?: number },
  ) {
    if (user.roleCode !== 'OWNER') {
      throw new ForbiddenException('Hanya Owner platform');
    }
    return this.audit.listEnriched({
      companyId: opts.companyId,
      action: opts.action,
      limit: opts.limit,
    });
  }

  listEmployeeRecords(
    user: JwtPayload,
    opts: { nik?: string; limit?: number },
  ) {
    const nik = opts.nik?.trim() ?? '';
    if (nik.length >= 16) {
      return this.records.searchByNikForOwner(user, nik);
    }
    return this.records.listAllForOwner(user, opts.limit);
  }

  async listPayments(limit = 100, type?: PaymentType) {
    const cap = Math.min(limit, 200);
    let query = this.db
      .select({
        payment: payments,
        companyName: companies.name,
      })
      .from(payments)
      .leftJoin(companies, eq(payments.companyId, companies.id))
      .$dynamic();

    if (type) {
      query = query.where(eq(payments.type, type));
    }

    const rows = await query
      .orderBy(desc(payments.createdAt))
      .limit(cap);

    return rows.map(({ payment, companyName }) => {
      const meta = (payment.metadata ?? {}) as Record<string, unknown>;
      return {
        ...payment,
        companyName,
        uniqueCode:
          typeof meta.uniqueCode === 'number' ? meta.uniqueCode : null,
        baseAmount:
          typeof meta.baseAmount === 'number'
            ? meta.baseAmount
            : Number(payment.amount),
        manualTransferPending:
          payment.gateway === 'manual' &&
          payment.status === 'PENDING' &&
          meta.manualTransfer === true,
      };
    });
  }

  async listBlacklists(limit = 100) {
    return this.db
      .select({
        blacklist: employeeBlacklists,
        companyName: companies.name,
      })
      .from(employeeBlacklists)
      .leftJoin(companies, eq(employeeBlacklists.companyId, companies.id))
      .orderBy(desc(employeeBlacklists.createdAt))
      .limit(Math.min(limit, 200));
  }

  async reportSummary() {
    const [paymentAgg] = await this.db
      .select({
        totalPaid: sql<string>`coalesce(sum(case when ${payments.status} = 'PAID' then ${payments.amount} else 0 end), 0)`,
        totalPending: sql<string>`coalesce(sum(case when ${payments.status} = 'PENDING' then ${payments.amount} else 0 end), 0)`,
        paidCount: sql<number>`count(*) filter (where ${payments.status} = 'PAID')`,
        pendingCount: sql<number>`count(*) filter (where ${payments.status} = 'PENDING')`,
        failedCount: sql<number>`count(*) filter (where ${payments.status} = 'FAILED')`,
      })
      .from(payments);

    const paymentByType = await this.db
      .select({
        type: payments.type,
        paidCount: sql<number>`count(*) filter (where ${payments.status} = 'PAID')`,
        paidAmountIdr: sql<string>`coalesce(sum(case when ${payments.status} = 'PAID' then ${payments.amount} else 0 end), 0)`,
        pendingCount: sql<number>`count(*) filter (where ${payments.status} = 'PENDING')`,
      })
      .from(payments)
      .groupBy(payments.type)
      .orderBy(payments.type);

    const [disputeAgg] = await this.db
      .select({
        open: sql<number>`count(*) filter (where ${disputes.status} in ('OPEN', 'INVESTIGATING'))`,
        total: sql<number>`count(*)`,
      })
      .from(disputes);

    const [companyAgg] = await this.db
      .select({
        total: sql<number>`count(*)`,
        active: sql<number>`count(*) filter (where ${companies.operationalStatus} = 'ACTIVE')`,
        underReview: sql<number>`count(*) filter (where ${companies.operationalStatus} = 'UNDER_REVIEW')`,
        pendingDocuments: sql<number>`count(*) filter (where ${companies.operationalStatus} = 'PENDING_DOCUMENTS')`,
        suspended: sql<number>`count(*) filter (where ${companies.operationalStatus} = 'SUSPENDED')`,
      })
      .from(companies);

    const [recordAgg] = await this.db
      .select({
        active: sql<number>`count(*) filter (where ${employeeRecords.deletedAt} is null)`,
        deleted: sql<number>`count(*) filter (where ${employeeRecords.deletedAt} is not null)`,
      })
      .from(employeeRecords);

    const [userAgg] = await this.db
      .select({
        total: sql<number>`count(*)`,
        active: sql<number>`count(*) filter (where ${users.isActive} = true)`,
      })
      .from(users);

    const [blacklistAgg] = await this.db
      .select({
        active: sql<number>`count(*) filter (where ${employeeBlacklists.status} = 'ACTIVE')`,
        cancelled: sql<number>`count(*) filter (where ${employeeBlacklists.status} = 'CANCELLED')`,
      })
      .from(employeeBlacklists);

    return {
      generatedAt: new Date().toISOString(),
      payments: {
        totalPaidIdr: Number(paymentAgg?.totalPaid ?? 0),
        pendingAmountIdr: Number(paymentAgg?.totalPending ?? 0),
        paidCount: Number(paymentAgg?.paidCount ?? 0),
        pendingCount: Number(paymentAgg?.pendingCount ?? 0),
        failedCount: Number(paymentAgg?.failedCount ?? 0),
        byType: paymentByType.map((row) => ({
          type: row.type,
          paidCount: Number(row.paidCount ?? 0),
          paidAmountIdr: Number(row.paidAmountIdr ?? 0),
          pendingCount: Number(row.pendingCount ?? 0),
        })),
      },
      disputes: {
        open: Number(disputeAgg?.open ?? 0),
        total: Number(disputeAgg?.total ?? 0),
      },
      companies: {
        total: Number(companyAgg?.total ?? 0),
        active: Number(companyAgg?.active ?? 0),
        underReview: Number(companyAgg?.underReview ?? 0),
        pendingDocuments: Number(companyAgg?.pendingDocuments ?? 0),
        suspended: Number(companyAgg?.suspended ?? 0),
      },
      employeeRecords: {
        active: Number(recordAgg?.active ?? 0),
        deleted: Number(recordAgg?.deleted ?? 0),
      },
      users: {
        total: Number(userAgg?.total ?? 0),
        active: Number(userAgg?.active ?? 0),
      },
      blacklists: {
        active: Number(blacklistAgg?.active ?? 0),
        cancelled: Number(blacklistAgg?.cancelled ?? 0),
      },
    };
  }

  async getSettings(user: JwtPayload) {
    if (user.roleCode !== 'OWNER') {
      throw new ForbiddenException('Hanya Owner platform');
    }

    const nodeEnv = this.config.get<string>('NODE_ENV') ?? 'development';
    const smtpHost = this.config.get<string>('SMTP_HOST')?.trim();
    const videoClient = this.siteVideo.getClientSettings();
    const corsRaw = this.config.get<string>('CORS_ORIGINS') ?? '';

    return {
      generatedAt: new Date().toISOString(),
      environment: {
        nodeEnv,
        isProduction: nodeEnv === 'production',
      },
      urls: {
        appUrl: this.config.get<string>('APP_URL') ?? null,
        apiUrl: this.config.get<string>('API_URL') ?? null,
        corsOrigins: corsRaw
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      },
      pricing: {
        subscriptionMonthlyIdr: Number(
          this.config.get('PRICE_SUBSCRIPTION_MONTHLY', 500000),
        ),
        ...(await this.pricing.getServiceFees()),
        viewAccessHourIdr: Number(this.config.get('PRICE_VIEW_HOUR', 25000)),
        viewAccessDayIdr: Number(this.config.get('PRICE_VIEW_DAY', 75000)),
        viewAccessMonthIdr: Number(
          this.config.get('PRICE_VIEW_MONTH', 200000),
        ),
        adPlacementIdr: (await this.pricing.getServiceFees()).adPlacementIdr,
        currency: 'IDR',
        source: 'db_or_env',
        hint:
          'Harga blacklist/sanggahan karyawan dan tarif dasar iklan di menu Paket & Harga; fallback PRICE_* di .env.',
      },
      payments: {
        gateway:
          this.config.get<string>('PAYMENT_GATEWAY', 'bimasakti') ?? 'bimasakti',
        mockCompleteEnabled:
          nodeEnv !== 'production' &&
          Boolean(this.config.get<string>('PAYMENT_MOCK_SECRET')?.trim()),
        manualPaymentBanks: {
          accounts: await this.pricing.getManualPaymentBanks(),
        },
        manualPaymentBankHint:
          'Rekening transfer manual (iklan, sanggahan) — atur di panel admin Pengaturan; PT bisa memilih rekening saat bayar.',
      },
      mail: {
        configured: Boolean(smtpHost),
        from: this.config.get<string>('SMTP_FROM') ?? null,
        host: smtpHost ? smtpHost.replace(/^(.{3}).*(.{8})$/, '$1…') : null,
      },
      siteVerification: {
        mode: this.siteVideo.getMode(),
        ...videoClient,
        webrtcConfigured: this.siteVideo.isWebrtcConfigured(),
      },
      features: {
        recordsDevUnrestrictedView:
          this.config.get<string>('RECORDS_DEV_UNRESTRICTED_VIEW') === 'true',
      },
      storage: {
        uploadDir: this.config.get<string>('UPLOAD_DIR') ?? 'uploads',
      },
    };
  }

  private static docTypeLabel(type: string) {
    const map: Record<string, string> = {
      NIB: 'NIB',
      KTP_PENANGGUNG_JAWAB: 'KTP penanggung jawab',
      AKTA: 'Akta perusahaan',
    };
    return map[type] ?? type;
  }

  /** Inbox Owner: PT baru, dokumen/syarat, pesanan iklan PT. */
  async getAdminNotifications(user: JwtPayload) {
    if (user.roleCode !== 'OWNER') {
      throw new ForbiddenException('Hanya Owner platform');
    }

    const windowStart = new Date(Date.now() - 60 * 86400_000);
    const cap = 50;

    const auditRows = await this.db
      .select({
        id: auditLogs.id,
        action: auditLogs.action,
        companyId: auditLogs.companyId,
        metadata: auditLogs.metadata,
        createdAt: auditLogs.createdAt,
        companyName: companies.name,
      })
      .from(auditLogs)
      .leftJoin(companies, eq(auditLogs.companyId, companies.id))
      .where(
        and(
          gte(auditLogs.createdAt, windowStart),
          inArray(auditLogs.action, [
            'COMPANY_REGISTER',
            'COMPANY_SURVEY_UPDATE',
          ]),
        ),
      )
      .orderBy(desc(auditLogs.createdAt))
      .limit(80);

    const adRows = await this.db
      .select({
        id: adPlacements.id,
        title: adPlacements.title,
        status: adPlacements.status,
        companyId: adPlacements.companyId,
        createdAt: adPlacements.createdAt,
        companyName: companies.name,
      })
      .from(adPlacements)
      .innerJoin(companies, eq(adPlacements.companyId, companies.id))
      .where(gte(adPlacements.createdAt, windowStart))
      .orderBy(desc(adPlacements.createdAt))
      .limit(40);

    type Item = {
      id: string;
      kind: string;
      title: string;
      message: string;
      companyId: string | null;
      companyName: string | null;
      createdAt: string;
      linkPath: string;
    };

    const items: Item[] = [];

    for (const row of auditRows) {
      const companyName = row.companyName ?? null;
      const companyId = row.companyId ?? null;
      const createdAt = row.createdAt.toISOString();
      const meta = (row.metadata ?? {}) as Record<string, unknown>;

      if (row.action === 'COMPANY_REGISTER') {
        items.push({
          id: `audit-${row.id}`,
          kind: 'COMPANY_REGISTER',
          title: 'Perusahaan baru terdaftar',
          message: companyName
            ? `${companyName} mendaftar di WorkRecord`
            : 'PT baru mendaftar',
          companyId,
          companyName,
          createdAt,
          linkPath: '/perusahaan',
        });
        continue;
      }

      if (row.action === 'COMPANY_SURVEY_UPDATE') {
        const sub = meta.action;
        if (sub === 'upload') {
          const docType = String(meta.type ?? 'dokumen');
          items.push({
            id: `audit-${row.id}`,
            kind: 'COMPANY_DOCUMENT',
            title: 'Dokumen syarat diunggah',
            message: `${companyName ?? 'PT'} — ${PlatformService.docTypeLabel(docType)}`,
            companyId,
            companyName,
            createdAt,
            linkPath: '/perusahaan',
          });
        } else if (sub === 'submit_for_review') {
          items.push({
            id: `audit-${row.id}`,
            kind: 'COMPANY_DOCUMENT',
            title: 'Syarat perusahaan diajukan',
            message: `${companyName ?? 'PT'} mengajukan tinjauan dokumen`,
            companyId,
            companyName,
            createdAt,
            linkPath: '/perusahaan',
          });
        } else if (sub === 'site_verification_request') {
          items.push({
            id: `audit-${row.id}`,
            kind: 'COMPANY_VERIFICATION',
            title: 'Ajuan verifikasi lapangan',
            message: `${companyName ?? 'PT'} meminta jadwal verifikasi`,
            companyId,
            companyName,
            createdAt,
            linkPath: '/perusahaan',
          });
        }
      }
    }

    for (const ad of adRows) {
      items.push({
        id: `ad-${ad.id}`,
        kind: 'AD_ORDER',
        title: 'Pesanan iklan',
        message: `${ad.companyName ?? 'PT'} — ${ad.title}`,
        companyId: ad.companyId,
        companyName: ad.companyName,
        createdAt: ad.createdAt.toISOString(),
        linkPath: '/iklan',
      });
    }

    items.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    return {
      generatedAt: new Date().toISOString(),
      items: items.slice(0, cap),
    };
  }
}
