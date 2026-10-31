import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import {
  generateMemberCertificateId,
  generateSecureToken,
} from '../common/utils/id-generator';
import { mkdir, readFile, unlink, writeFile } from 'fs/promises';
import { extname, join } from 'path';
import { DatabaseService } from '../database/database.service';
import { companies, companyDocuments } from '../database/schema';
import { JwtPayload } from '../auth/types/jwt-payload';
import { AuditService } from '../audit/audit.service';
import { RequestSiteVerificationDto } from './dto/request-site-verification.dto';
import { ScheduleSiteVerificationDto } from './dto/schedule-site-verification.dto';
import { SiteVerificationVideoService } from './site-verification-video.service';

export const COMPANY_DOCUMENT_TYPES = [
  'NIB',
  'KTP_PENANGGUNG_JAWAB',
  'AKTA',
] as const;
export type CompanyDocumentType = (typeof COMPANY_DOCUMENT_TYPES)[number];

const PDF_ONLY_DOCUMENT_TYPES: CompanyDocumentType[] = ['NIB', 'AKTA'];

/** Selaras dengan validasi frontend dan nginx `client_max_body_size`. */
const COMPANY_DOCUMENT_MAX_BYTES = 5 * 1024 * 1024;

@Injectable()
export class CompanyDocumentsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly siteVerificationVideo: SiteVerificationVideoService,
  ) {}

  private get db() {
    return this.database.db;
  }

  private uploadRoot() {
    return process.env.UPLOAD_DIR ?? join(process.cwd(), 'uploads');
  }

  async ensureDocumentRows(companyId: string) {
    for (const type of COMPANY_DOCUMENT_TYPES) {
      const existing = await this.db.query.companyDocuments.findFirst({
        where: and(
          eq(companyDocuments.companyId, companyId),
          eq(companyDocuments.type, type),
        ),
      });
      if (!existing) {
        await this.db.insert(companyDocuments).values({
          companyId,
          type,
          status: 'MISSING',
        });
      }
    }
  }

  async getVerificationStatus(companyId: string) {
    await this.ensureDocumentRows(companyId);
    const company = await this.db.query.companies.findFirst({
      where: eq(companies.id, companyId),
    });
    if (!company) throw new NotFoundException();
    const docs = await this.db
      .select()
      .from(companyDocuments)
      .where(eq(companyDocuments.companyId, companyId));
    const allApproved = docs.every((d) => d.status === 'APPROVED');
    const activeCompany =
      company.operationalStatus === 'ACTIVE' && allApproved
        ? await this.ensureMemberCertificate(companyId)
        : company;

    return {
      companyId,
      operationalStatus: activeCompany.operationalStatus,
      surveyStatus: activeCompany.surveyStatus,
      verifiedAt: activeCompany.verifiedAt,
      documents: docs.map((d) => ({
        type: d.type,
        status: d.status,
        rejectReason: d.rejectReason,
        uploadedAt: d.uploadedAt,
        reviewedAt: d.reviewedAt,
        hasFile: Boolean(d.filePath),
      })),
      canSubmitForReview: docs.every(
        (d) => d.filePath && d.status !== 'MISSING',
      ),
      allApproved,
      siteVerification: this.mapSiteVerification(activeCompany),
      memberCertificate: this.mapMemberCertificate(activeCompany, allApproved),
    };
  }

  private mapMemberCertificate(
    company: typeof companies.$inferSelect,
    allApproved: boolean,
  ) {
    if (
      company.operationalStatus !== 'ACTIVE' ||
      !allApproved ||
      !company.memberVerifyToken ||
      !company.memberCertificateId
    ) {
      return null;
    }
    const joinedAt = company.verifiedAt ?? company.createdAt;
    return {
      memberId: company.memberCertificateId,
      verifyToken: company.memberVerifyToken,
      validUntil: company.memberCertificateExpiresAt,
      joinedAt,
      lastVerifiedAt: company.verifiedAt ?? joinedAt,
      domicile: this.inferDomicile(company),
      canDownload: true,
    };
  }

  private inferDomicile(company: typeof companies.$inferSelect): string | null {
    const raw = company.siteVerificationAddress?.trim();
    if (!raw) return null;
    const parts = raw
      .split(/[,;\n]/)
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length >= 2) {
      return parts.slice(-2).join(', ');
    }
    return raw;
  }

  private async uniqueMemberCertificateId(): Promise<string> {
    for (let i = 0; i < 12; i++) {
      const id = generateMemberCertificateId();
      const exists = await this.db.query.companies.findFirst({
        where: eq(companies.memberCertificateId, id),
      });
      if (!exists) return id;
    }
    throw new BadRequestException('Gagal membuat Member ID');
  }

  async ensureMemberCertificate(companyId: string) {
    const company = await this.db.query.companies.findFirst({
      where: eq(companies.id, companyId),
    });
    if (!company) throw new NotFoundException();
    if (company.operationalStatus !== 'ACTIVE') return company;
    if (company.memberVerifyToken && company.memberCertificateId) {
      return company;
    }

    const memberCertificateId = await this.uniqueMemberCertificateId();
    const memberVerifyToken = generateSecureToken();
    const joinedAt = company.verifiedAt ?? new Date();
    const validUntil = new Date(joinedAt);
    validUntil.setFullYear(validUntil.getFullYear() + 1);

    const [updated] = await this.db
      .update(companies)
      .set({
        memberCertificateId,
        memberVerifyToken,
        memberCertificateExpiresAt: validUntil,
        updatedAt: new Date(),
      })
      .where(eq(companies.id, companyId))
      .returning();

    return updated;
  }

  async getPublicMemberVerification(token: string) {
    const company = await this.db.query.companies.findFirst({
      where: eq(companies.memberVerifyToken, token),
    });
    if (!company || company.operationalStatus !== 'ACTIVE') {
      throw new NotFoundException('Keanggotaan tidak ditemukan atau tidak aktif');
    }

    const status = await this.getVerificationStatus(company.id);
    if (!status.allApproved) {
      throw new NotFoundException('Keanggotaan belum lengkap');
    }

    const joinedAt = company.verifiedAt ?? company.createdAt;
    const validUntil =
      company.memberCertificateExpiresAt ??
      new Date(new Date(joinedAt).setFullYear(joinedAt.getFullYear() + 1));

    return {
      companyName: company.name,
      memberId: company.memberCertificateId,
      verifyToken: company.memberVerifyToken,
      membershipStatus: company.isActive ? 'ACTIVE' : 'SUSPENDED',
      verificationStatus: 'VERIFIED',
      memberCategory: 'Corporate Member',
      businessField: company.businessField,
      domicile: this.inferDomicile(company),
      joinedAt,
      validUntil,
      lastVerifiedAt: company.verifiedAt ?? joinedAt,
    };
  }

  private mapSiteVerification(company: typeof companies.$inferSelect) {
    return {
      status: company.siteVerificationStatus,
      method: company.siteVerificationMethod,
      contactName: company.siteVerificationContactName,
      contactPhone: company.siteVerificationContactPhone,
      address: company.siteVerificationAddress,
      preferredScheduleNote: company.siteVerificationPreferredNote,
      scheduledAt: company.siteVerificationScheduledAt,
      meetingUrl: company.siteVerificationMeetingUrl,
      adminNotes: company.siteVerificationAdminNotes,
      completedAt: company.siteVerificationCompletedAt,
      canRequest:
        company.operationalStatus === 'UNDER_REVIEW' &&
        company.siteVerificationStatus === 'NOT_REQUESTED',
      video: this.siteVerificationVideo.getVerificationVideoMeta(),
    };
  }

  async requestSiteVerification(
    companyId: string,
    actor: JwtPayload,
    dto: RequestSiteVerificationDto,
  ) {
    this.assertCompanyMember(actor, companyId);
    const company = await this.db.query.companies.findFirst({
      where: eq(companies.id, companyId),
    });
    if (!company) throw new NotFoundException();
    if (company.operationalStatus === 'ACTIVE') {
      throw new BadRequestException('Perusahaan sudah aktif');
    }
    if (company.siteVerificationStatus !== 'NOT_REQUESTED') {
      throw new BadRequestException(
        'Permintaan verifikasi lapangan sudah dikirim',
      );
    }

    await this.db
      .update(companies)
      .set({
        siteVerificationMethod: dto.method,
        siteVerificationStatus: 'AWAITING_SCHEDULE',
        siteVerificationContactName: dto.contactName.trim(),
        siteVerificationContactPhone: dto.contactPhone.trim(),
        siteVerificationAddress: dto.address.trim(),
        siteVerificationPreferredNote: dto.preferredScheduleNote?.trim() ?? null,
        updatedAt: new Date(),
      })
      .where(eq(companies.id, companyId));

    await this.audit.log({
      action: 'COMPANY_SURVEY_UPDATE',
      actorUserId: actor.sub,
      companyId,
      entityType: 'Company',
      entityId: companyId,
      metadata: { action: 'site_verification_request', method: dto.method },
    });

    return this.getVerificationStatus(companyId);
  }

  async scheduleSiteVerification(
    companyId: string,
    actorUserId: string,
    dto: ScheduleSiteVerificationDto,
  ) {
    const company = await this.db.query.companies.findFirst({
      where: eq(companies.id, companyId),
    });
    if (!company) throw new NotFoundException();
    if (
      company.siteVerificationStatus !== 'AWAITING_SCHEDULE' &&
      company.siteVerificationStatus !== 'SCHEDULED'
    ) {
      throw new BadRequestException(
        'Perusahaan belum mengajukan verifikasi lapangan',
      );
    }
    if (
      company.siteVerificationMethod === 'VIDEO_CALL' &&
      !dto.meetingUrl?.trim()
    ) {
      throw new BadRequestException(
        'URL meeting wajib untuk verifikasi video call',
      );
    }

    await this.db
      .update(companies)
      .set({
        siteVerificationStatus: 'SCHEDULED',
        siteVerificationScheduledAt: new Date(dto.scheduledAt),
        siteVerificationMeetingUrl: dto.meetingUrl?.trim() ?? null,
        siteVerificationAdminNotes: dto.adminNotes?.trim() ?? null,
        updatedAt: new Date(),
      })
      .where(eq(companies.id, companyId));

    await this.audit.log({
      action: 'COMPANY_SURVEY_UPDATE',
      actorUserId,
      companyId,
      entityType: 'Company',
      entityId: companyId,
      metadata: { action: 'site_verification_scheduled' },
    });

    return this.getVerificationStatus(companyId);
  }

  async completeSiteVerification(companyId: string, actorUserId: string) {
    const company = await this.db.query.companies.findFirst({
      where: eq(companies.id, companyId),
    });
    if (!company) throw new NotFoundException();
    if (
      company.siteVerificationStatus !== 'SCHEDULED' &&
      company.siteVerificationStatus !== 'AWAITING_SCHEDULE'
    ) {
      if (company.siteVerificationStatus === 'NOT_REQUESTED') {
        throw new BadRequestException(
          'Perusahaan belum mengajukan verifikasi video call atau kunjungan lokasi',
        );
      }
      if (company.siteVerificationStatus === 'COMPLETED') {
        throw new BadRequestException('Verifikasi lapangan sudah selesai');
      }
      throw new BadRequestException(
        'Verifikasi lapangan belum siap ditandai selesai',
      );
    }

    await this.db
      .update(companies)
      .set({
        siteVerificationStatus: 'COMPLETED',
        siteVerificationCompletedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(companies.id, companyId));

    await this.audit.log({
      action: 'COMPANY_SURVEY_UPDATE',
      actorUserId,
      companyId,
      entityType: 'Company',
      entityId: companyId,
      metadata: { action: 'site_verification_completed' },
    });

    return this.getVerificationStatus(companyId);
  }

  assertCompanyMember(actor: JwtPayload, companyId: string) {
    if (actor.roleCode === 'OWNER') return;
    if (actor.companyId !== companyId) {
      throw new ForbiddenException('Akses ditolak');
    }
  }

  private isPdfBuffer(data: Buffer): boolean {
    return data.length >= 4 && data.subarray(0, 4).toString() === '%PDF';
  }

  private resolveUploadExtension(
    type: CompanyDocumentType,
    file: { buffer: Buffer; originalname: string },
  ): string {
    const rawExt = extname(file.originalname).toLowerCase();

    if (PDF_ONLY_DOCUMENT_TYPES.includes(type)) {
      if (rawExt !== '.pdf') {
        throw new BadRequestException(
          'NIB dan Akta perusahaan hanya boleh diunggah dalam format PDF',
        );
      }
      if (!this.isPdfBuffer(file.buffer)) {
        throw new BadRequestException(
          'Berkas NIB/Akta tidak valid atau bukan PDF',
        );
      }
      return '.pdf';
    }

    const allowedExt = ['.pdf', '.jpg', '.jpeg', '.png', '.webp'];
    if (!allowedExt.includes(rawExt)) {
      throw new BadRequestException(
        'Format berkas tidak didukung. Gunakan PDF atau gambar (JPG, PNG, WebP).',
      );
    }
    return rawExt;
  }

  async uploadDocument(
    companyId: string,
    type: CompanyDocumentType,
    file: { buffer: Buffer; originalname: string },
    actor: JwtPayload,
  ) {
    this.assertCompanyMember(actor, companyId);
    const company = await this.db.query.companies.findFirst({
      where: eq(companies.id, companyId),
    });
    if (!company) throw new NotFoundException();
    if (company.operationalStatus === 'ACTIVE') {
      throw new BadRequestException('Perusahaan sudah aktif');
    }
    if (!file?.buffer?.length) {
      throw new BadRequestException('File wajib diunggah');
    }
    if (file.buffer.length > COMPANY_DOCUMENT_MAX_BYTES) {
      throw new BadRequestException(
        'Ukuran berkas maksimal 5 MB per dokumen',
      );
    }

    await this.ensureDocumentRows(companyId);
    const dir = join(this.uploadRoot(), 'companies', companyId);
    await mkdir(dir, { recursive: true });
    const ext = this.resolveUploadExtension(type, file);
    const safeName = `${type}-${Date.now()}${ext}`;
    const filePath = join(dir, safeName);
    await writeFile(filePath, file.buffer);

    const [doc] = await this.db
      .update(companyDocuments)
      .set({
        filePath,
        status: 'PENDING',
        rejectReason: null,
        uploadedAt: new Date(),
        reviewedAt: null,
        reviewedByUserId: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(companyDocuments.companyId, companyId),
          eq(companyDocuments.type, type),
        ),
      )
      .returning();

    if (company.operationalStatus === 'PENDING_DOCUMENTS') {
      await this.db
        .update(companies)
        .set({ updatedAt: new Date() })
        .where(eq(companies.id, companyId));
    }

    await this.audit.log({
      action: 'COMPANY_SURVEY_UPDATE',
      actorUserId: actor.sub,
      companyId,
      entityType: 'CompanyDocument',
      entityId: doc.id,
      metadata: { type, action: 'upload' },
    });

    return doc;
  }

  async submitForReview(companyId: string, actor: JwtPayload) {
    this.assertCompanyMember(actor, companyId);
    const status = await this.getVerificationStatus(companyId);
    if (!status.canSubmitForReview) {
      throw new BadRequestException(
        'Unggah NIB, KTP penanggung jawab, dan Akta terlebih dahulu',
      );
    }
    if (status.operationalStatus === 'ACTIVE') {
      throw new BadRequestException('Perusahaan sudah aktif');
    }

    await this.db
      .update(companies)
      .set({
        operationalStatus: 'UNDER_REVIEW',
        surveyStatus: 'IN_PROGRESS',
        updatedAt: new Date(),
      })
      .where(eq(companies.id, companyId));

    await this.audit.log({
      action: 'COMPANY_SURVEY_UPDATE',
      actorUserId: actor.sub,
      companyId,
      entityType: 'Company',
      entityId: companyId,
      metadata: { action: 'submit_for_review' },
    });

    return this.getVerificationStatus(companyId);
  }

  async reviewDocument(
    companyId: string,
    type: CompanyDocumentType,
    approve: boolean,
    actorUserId: string,
    rejectReason?: string,
  ) {
    if (!approve && !rejectReason?.trim()) {
      throw new BadRequestException('Alasan penolakan wajib diisi');
    }

    const doc = await this.db.query.companyDocuments.findFirst({
      where: and(
        eq(companyDocuments.companyId, companyId),
        eq(companyDocuments.type, type),
      ),
    });
    if (!doc || !doc.filePath) {
      throw new NotFoundException('Dokumen belum diunggah');
    }

    const [updated] = await this.db
      .update(companyDocuments)
      .set({
        status: approve ? 'APPROVED' : 'REJECTED',
        rejectReason: approve ? null : rejectReason?.trim(),
        reviewedAt: new Date(),
        reviewedByUserId: actorUserId,
        updatedAt: new Date(),
      })
      .where(eq(companyDocuments.id, doc.id))
      .returning();

    await this.audit.log({
      action: 'COMPANY_SURVEY_UPDATE',
      actorUserId,
      companyId,
      entityType: 'CompanyDocument',
      entityId: doc.id,
      metadata: { type, approve, rejectReason },
    });

    return updated;
  }

  /**
   * Owner meminta PT mengunggah ulang satu dokumen.
   * Portal dikunci (PENDING_DOCUMENTS) sampai verifikasi penuh selesai lagi.
   */
  async requestDocumentReupload(
    companyId: string,
    type: CompanyDocumentType,
    actorUserId: string,
    note?: string,
  ) {
    await this.ensureDocumentRows(companyId);
    const company = await this.db.query.companies.findFirst({
      where: eq(companies.id, companyId),
    });
    if (!company) throw new NotFoundException();

    const doc = await this.db.query.companyDocuments.findFirst({
      where: and(
        eq(companyDocuments.companyId, companyId),
        eq(companyDocuments.type, type),
      ),
    });
    if (!doc?.filePath) {
      throw new BadRequestException('Belum ada berkas untuk diminta unggah ulang');
    }

    try {
      await unlink(doc.filePath);
    } catch {
      /* berkas mungkin sudah tidak ada di disk */
    }

    const portalNote =
      note?.trim() ||
      'Tim WorkRecord meminta Anda mengunggah ulang berkas ini. Portal terkunci sampai verifikasi selesai lagi.';

    await this.db
      .update(companyDocuments)
      .set({
        filePath: null,
        status: 'MISSING',
        rejectReason: portalNote,
        uploadedAt: null,
        reviewedAt: null,
        reviewedByUserId: null,
        updatedAt: new Date(),
      })
      .where(eq(companyDocuments.id, doc.id));

    const wasActive = company.operationalStatus === 'ACTIVE';

    await this.db
      .update(companies)
      .set({
        operationalStatus: 'PENDING_DOCUMENTS',
        surveyStatus: wasActive ? 'PENDING' : company.surveyStatus,
        verifiedAt: null,
        siteVerificationStatus: 'NOT_REQUESTED',
        siteVerificationMethod: null,
        siteVerificationScheduledAt: null,
        siteVerificationMeetingUrl: null,
        siteVerificationAdminNotes: null,
        siteVerificationCompletedAt: null,
        memberCertificateId: null,
        memberVerifyToken: null,
        memberCertificateExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(eq(companies.id, companyId));

    await this.audit.log({
      action: 'COMPANY_SURVEY_UPDATE',
      actorUserId,
      companyId,
      entityType: 'CompanyDocument',
      entityId: doc.id,
      metadata: { type, action: 'request_reupload', note: portalNote },
    });

    return this.getVerificationStatus(companyId);
  }

  async activateCompanyIfReady(companyId: string, actorUserId: string) {
    const status = await this.getVerificationStatus(companyId);
    if (!status.allApproved) {
      throw new BadRequestException(
        'Semua dokumen harus disetujui sebelum aktivasi',
      );
    }
    if (status.siteVerification.status !== 'COMPLETED') {
      throw new BadRequestException(
        'Verifikasi video call atau kunjungan lokasi harus diselesaikan sebelum aktivasi',
      );
    }

    const [company] = await this.db
      .update(companies)
      .set({
        operationalStatus: 'ACTIVE',
        surveyStatus: 'VERIFIED',
        verifiedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(companies.id, companyId))
      .returning();

    await this.audit.log({
      action: 'COMPANY_SURVEY_UPDATE',
      actorUserId,
      companyId,
      entityType: 'Company',
      entityId: companyId,
      metadata: { action: 'activate' },
    });

    return this.ensureMemberCertificate(companyId);
  }

  async getFilePath(companyId: string, type: CompanyDocumentType) {
    const doc = await this.db.query.companyDocuments.findFirst({
      where: and(
        eq(companyDocuments.companyId, companyId),
        eq(companyDocuments.type, type),
      ),
    });
    if (!doc?.filePath) throw new NotFoundException();
    return doc.filePath;
  }

  guessContentType(filePath: string, data: Buffer): string {
    if (data.length >= 4 && data.subarray(0, 4).toString() === '%PDF') {
      return 'application/pdf';
    }
    if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8) {
      return 'image/jpeg';
    }
    if (
      data.length >= 8 &&
      data[0] === 0x89 &&
      data[1] === 0x50 &&
      data[2] === 0x4e &&
      data[3] === 0x47
    ) {
      return 'image/png';
    }
    const ext = extname(filePath).toLowerCase();
    switch (ext) {
      case '.pdf':
        return 'application/pdf';
      case '.jpg':
      case '.jpeg':
        return 'image/jpeg';
      case '.png':
        return 'image/png';
      case '.webp':
        return 'image/webp';
      default:
        return 'application/octet-stream';
    }
  }

  async readDocumentFile(companyId: string, type: CompanyDocumentType) {
    const filePath = await this.getFilePath(companyId, type);
    const data = await readFile(filePath);
    return {
      data,
      filePath,
      contentType: this.guessContentType(filePath, data),
    };
  }
}
