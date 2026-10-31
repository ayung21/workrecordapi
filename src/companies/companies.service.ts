import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { and, asc, count, desc, eq, gt, inArray, isNull, or } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import {
  companies,
  emailVerificationTokens,
  payments,
  roles,
  subscriptions,
  users,
} from '../database/schema';
import { generatePublicLoginId, generateSecureToken } from '../common/utils/id-generator';
import { MailService } from '../mail/mail.service';
import { RegisterCompanyDto } from './dto/register-company.dto';
import { COMPANY_TERMS_VERSION } from './constants';
import { PaymentsService } from '../payments/payments.service';
import { AuthService } from '../auth/auth.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { InviteLeadershipDto } from './dto/invite-leadership.dto';
import { JwtPayload } from '../auth/types/jwt-payload';
import { AuditService } from '../audit/audit.service';
import { CompanyDocumentsService } from './company-documents.service';
import {
  employeeBlacklists,
  employeeProfiles,
  employeeRecords,
  recordChangeRequests,
} from '../database/schema';
import { BlacklistsService } from '../blacklists/blacklists.service';
import { AccessService } from '../access/access.service';

@Injectable()
export class CompaniesService {
  private readonly logger = new Logger(CompaniesService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly mail: MailService,
    private readonly payments: PaymentsService,
    private readonly auth: AuthService,
    private readonly subscriptions: SubscriptionsService,
    private readonly audit: AuditService,
    private readonly companyDocuments: CompanyDocumentsService,
    private readonly blacklists: BlacklistsService,
    private readonly access: AccessService,
  ) {}

  private get db() {
    return this.database.db;
  }

  async register(dto: RegisterCompanyDto) {
    const termsVersion = dto.termsVersion ?? COMPANY_TERMS_VERSION;
    if (termsVersion !== COMPANY_TERMS_VERSION) {
      throw new BadRequestException(
        'Versi syarat ketentuan tidak valid. Muat ulang halaman pendaftaran.',
      );
    }

    const email = dto.email.toLowerCase();
    const partnerEmail = dto.partnerAccount.email.toLowerCase();
    if (email === partnerEmail) {
      throw new BadRequestException(
        'Email akun pembayar dan akun kedua harus berbeda',
      );
    }

    for (const addr of [email, partnerEmail]) {
      const existing = await this.db.query.users.findFirst({
        where: eq(users.email, addr),
      });
      if (existing) {
        throw new ConflictException(`Email ${addr} sudah terdaftar`);
      }
    }

    const adminRole = await this.db.query.roles.findFirst({
      where: eq(roles.code, 'COMPANY_ADMIN'),
    });
    const leaderRole = await this.db.query.roles.findFirst({
      where: eq(roles.code, 'COMPANY_LEADERSHIP'),
    });
    if (!adminRole || !leaderRole) {
      throw new Error('Roles not seeded. Run: npm run db:seed');
    }

    const partnerIsBawahan = dto.partnerAccount.relationRole === 'BAWAHAN';
    const primaryIsAtasan = partnerIsBawahan;

    const primaryRole = primaryIsAtasan ? leaderRole : adminRole;
    const partnerRole = primaryIsAtasan ? adminRole : leaderRole;
    const primaryAccountType = primaryIsAtasan ? 'LEADERSHIP' : 'ADMIN';
    const partnerAccountType = primaryIsAtasan ? 'ADMIN' : 'LEADERSHIP';
    const primaryPrefix = primaryIsAtasan ? 'LDR' : 'ADM';
    const partnerPrefix = primaryIsAtasan ? 'ADM' : 'LDR';

    const adminPublicId = await this.uniquePublicId('ADM');
    const leaderPublicId = await this.uniquePublicId('LDR');
    const primaryPublicId =
      primaryPrefix === 'ADM' ? adminPublicId : leaderPublicId;
    const partnerPublicId =
      partnerPrefix === 'ADM' ? adminPublicId : leaderPublicId;

    const primaryPasswordHash = await bcrypt.hash(dto.password, 12);
    const partnerPasswordHash = await bcrypt.hash(generateSecureToken(), 12);
    const termsAcceptedAt = new Date();
    const termsAcceptance = { ...dto.terms };

    const result = await this.db.transaction(async (tx) => {
      const [company] = await tx
        .insert(companies)
        .values({
          name: dto.companyName,
          companyPhone: dto.companyPhone,
          businessField: dto.businessField.trim(),
          adminPublicId,
          leaderPublicId,
          leadershipInvitedAt: new Date(),
          termsVersion,
          termsAcceptedAt,
          termsAcceptance,
        })
        .returning();

      const [primaryUser] = await tx
        .insert(users)
        .values({
          publicLoginId: primaryPublicId,
          email,
          passwordHash: primaryPasswordHash,
          fullName: dto.fullName,
          personalPhone: dto.personalPhone,
          accountType: primaryAccountType,
          roleId: primaryRole.id,
          companyId: company.id,
        })
        .returning();

      await tx
        .update(companies)
        .set({
          registeredByUserId: primaryUser.id,
          updatedAt: new Date(),
        })
        .where(eq(companies.id, company.id));

      const [partnerUser] = await tx
        .insert(users)
        .values({
          publicLoginId: partnerPublicId,
          email: partnerEmail,
          passwordHash: partnerPasswordHash,
          fullName: dto.partnerAccount.fullName,
          personalPhone: dto.partnerAccount.personalPhone,
          accountType: partnerAccountType,
          roleId: partnerRole.id,
          companyId: company.id,
        })
        .returning();

      return { company, primaryUser, partnerUser };
    });

    const primaryRoleLabel = primaryIsAtasan ? 'Master (Atasan)' : 'Admin (Bawahan)';
    const partnerRoleLabel = primaryIsAtasan ? 'Admin (Bawahan)' : 'Master (Atasan)';

    await this.companyDocuments.ensureDocumentRows(result.company.id);

    try {
      await this.auth.sendAccountActivation(result.partnerUser.id, {
        publicLoginId: partnerPublicId,
        roleLabel: partnerRoleLabel,
        companyName: dto.companyName,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Email aktivasi akun kedua gagal (${partnerEmail}): ${message}`,
      );
      throw new BadRequestException(
        'Perusahaan terdaftar, tetapi email aktivasi ke akun kedua gagal dikirim. Periksa konfigurasi SMTP atau hubungi admin WorkRecord.',
      );
    }

    try {
      await this.mail.sendMail({
        to: email,
        subject: 'Registrasi WorkRecord — unggah dokumen perusahaan',
        html: `
        <p>Terima kasih mendaftarkan <strong>${dto.companyName}</strong> di WorkRecord.</p>
        <p>Peran Anda: <strong>${primaryRoleLabel}</strong></p>
        <p><strong>ID Login:</strong> ${primaryPublicId}</p>
        <p>Akun kedua (${partnerRoleLabel}, ${partnerEmail}) telah dikirimi email untuk mengatur kata sandi.</p>
        <p>Login lalu unggah NIB, KTP penanggung jawab, dan Akta perusahaan. Setelah diverifikasi WorkRecord, Anda dapat mencari riwayat kerja berdasarkan NIK KTP karyawan.</p>
      `,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Email registrasi ke pembayar gagal (${email}): ${message}`);
    }

    try {
      await this.auth.requestEmailVerification(result.primaryUser.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Email verifikasi pembayar gagal (${email}): ${message}`,
      );
    }

    await this.audit.log({
      action: 'COMPANY_REGISTER',
      actorUserId: result.primaryUser.id,
      companyId: result.company.id,
      entityType: 'Company',
      entityId: result.company.id,
      metadata: {
        adminPublicId,
        leaderPublicId,
        primaryRole: primaryAccountType,
        partnerRole: partnerAccountType,
        termsVersion,
      },
    });

    return {
      companyId: result.company.id,
      adminPublicId,
      leaderPublicId,
      primaryPublicId,
      partnerPublicId,
      primaryRole: primaryAccountType,
      partnerRole: partnerAccountType,
      partnerEmail,
      message:
        `Registrasi berhasil. Email aktivasi (atur kata sandi) telah dikirim ke akun kedua: ${partnerEmail}.`,
    };
  }

  async getMyCompany(actor: JwtPayload) {
    if (!actor.companyId) {
      throw new ForbiddenException('Bukan akun perusahaan');
    }
    const company = await this.findOne(actor.companyId);
    const verification = await this.companyDocuments.getVerificationStatus(
      actor.companyId,
    );
    return { ...company, verification };
  }

  private async assertCompanyMember(actor: JwtPayload, companyId: string) {
    if (actor.roleCode === 'OWNER') return;
    if (actor.companyId !== companyId) {
      throw new ForbiddenException('Akses ditolak');
    }
  }

  private async canEditCompanySettings(actor: JwtPayload): Promise<boolean> {
    if (actor.roleCode === 'OWNER') return true;
    const user = await this.db.query.users.findFirst({
      where: eq(users.id, actor.sub),
    });
    return user?.accountType === 'LEADERSHIP';
  }

  private async assertLeadershipPortalSettings(
    actor: JwtPayload,
    companyId: string,
  ) {
    await this.assertCompanyMember(actor, companyId);
    if (actor.roleCode === 'OWNER') {
      throw new ForbiddenException(
        'Pengaturan portal hanya untuk akun Pimpinan perusahaan',
      );
    }
    const canEdit = await this.canEditCompanySettings(actor);
    if (!canEdit) {
      throw new ForbiddenException(
        'Hanya akun Pimpinan (Master) yang dapat mengubah pengaturan',
      );
    }
  }

  private async findCompanyAdminUser(companyId: string) {
    const admin = await this.db.query.users.findFirst({
      where: and(
        eq(users.companyId, companyId),
        eq(users.accountType, 'ADMIN'),
      ),
    });
    if (!admin) {
      throw new NotFoundException('Akun Admin perusahaan tidak ditemukan');
    }
    return admin;
  }

  private async pendingEmailChangeForUser(userId: string) {
    const rows = await this.db
      .select({
        newEmail: emailVerificationTokens.newEmail,
        expiresAt: emailVerificationTokens.expiresAt,
      })
      .from(emailVerificationTokens)
      .where(
        and(
          eq(emailVerificationTokens.userId, userId),
          isNull(emailVerificationTokens.usedAt),
          gt(emailVerificationTokens.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(emailVerificationTokens.createdAt))
      .limit(1);
    return rows[0] ?? null;
  }

  async getCompanySettings(companyId: string, actor: JwtPayload) {
    await this.assertLeadershipPortalSettings(actor, companyId);
    const company = await this.findOne(companyId);
    const admin = await this.findCompanyAdminUser(companyId);
    const pending = await this.pendingEmailChangeForUser(admin.id);
    return {
      id: company.id,
      name: company.name,
      companyPhone: company.companyPhone,
      operationalStatus: company.operationalStatus,
      adminAccount: {
        fullName: admin.fullName,
        publicLoginId: admin.publicLoginId,
        email: admin.email,
        personalPhone: admin.personalPhone,
        emailVerifiedAt: admin.emailVerifiedAt,
        pendingEmail: pending?.newEmail ?? null,
        pendingEmailExpiresAt: pending?.expiresAt ?? null,
      },
    };
  }

  async updateCompanySettings(
    companyId: string,
    actor: JwtPayload,
    input: { adminEmail?: string; adminFullName?: string; companyPhone?: string },
  ) {
    await this.assertLeadershipPortalSettings(actor, companyId);
    const admin = await this.findCompanyAdminUser(companyId);
    const company = await this.findOne(companyId);

    if (
      input.adminEmail === undefined &&
      input.adminFullName === undefined &&
      input.companyPhone === undefined
    ) {
      throw new BadRequestException('Tidak ada perubahan');
    }

    if (input.adminFullName !== undefined) {
      const name = input.adminFullName.trim();
      if (name.length < 2) {
        throw new BadRequestException('Nama admin minimal 2 karakter');
      }
      if (name !== admin.fullName) {
        await this.db
          .update(users)
          .set({ fullName: name, updatedAt: new Date() })
          .where(eq(users.id, admin.id));
        await this.audit.log({
          action: 'RECORD_UPDATE',
          actorUserId: actor.sub,
          companyId,
          entityType: 'User',
          entityId: admin.id,
          metadata: { field: 'adminFullName' },
        });
      }
    }

    if (input.companyPhone !== undefined) {
      const phone = input.companyPhone.trim();
      if (phone.length < 8) {
        throw new BadRequestException('Telepon perusahaan minimal 8 karakter');
      }
      await this.db
        .update(companies)
        .set({ companyPhone: phone, updatedAt: new Date() })
        .where(eq(companies.id, companyId));
      await this.audit.log({
        action: 'RECORD_UPDATE',
        actorUserId: actor.sub,
        companyId,
        entityType: 'Company',
        entityId: companyId,
        metadata: { field: 'companyPhone' },
      });
    }

    if (input.adminEmail !== undefined) {
      const nextEmail = input.adminEmail.trim().toLowerCase();
      if (nextEmail === admin.email.toLowerCase()) {
        throw new BadRequestException('Email baru sama dengan email saat ini');
      }
      const taken = await this.db.query.users.findFirst({
        where: eq(users.email, nextEmail),
      });
      if (taken && taken.id !== admin.id) {
        throw new ConflictException('Email sudah digunakan akun lain');
      }
      const leader = await this.db.query.users.findFirst({
        where: eq(users.id, actor.sub),
      });
      await this.auth.sendEmailChangeVerification(admin.id, nextEmail, {
        companyName: company.name,
        initiatedBy: leader?.fullName ?? 'Pimpinan perusahaan',
        roleLabel: 'Admin perusahaan',
      });
      await this.audit.log({
        action: 'RECORD_UPDATE',
        actorUserId: actor.sub,
        companyId,
        entityType: 'User',
        entityId: admin.id,
        metadata: { field: 'adminEmail', pendingEmail: nextEmail },
      });
    }

    return this.getCompanySettings(companyId, actor);
  }

  async updateCompanyProfileByOwner(
    companyId: string,
    input: { businessField?: string },
  ) {
    if (input.businessField === undefined) {
      throw new BadRequestException('Tidak ada perubahan');
    }
    const trimmed = input.businessField.trim();
    if (trimmed.length > 0 && trimmed.length < 2) {
      throw new BadRequestException('Bidang usaha minimal 2 karakter');
    }
    const businessField = trimmed.length ? trimmed : null;
    const [updated] = await this.db
      .update(companies)
      .set({ businessField, updatedAt: new Date() })
      .where(eq(companies.id, companyId))
      .returning({
        id: companies.id,
        name: companies.name,
        companyPhone: companies.companyPhone,
        businessField: companies.businessField,
        operationalStatus: companies.operationalStatus,
      });
    if (!updated) throw new NotFoundException();
    return updated;
  }

  async listCompanyEmployees(companyId: string, actor: JwtPayload) {
    if (actor.roleCode !== 'OWNER' && actor.companyId !== companyId) {
      throw new ForbiddenException();
    }
    await this.access.assertPortalCompanyActive(actor);
    const rows = await this.db
      .select({
        record: employeeRecords,
        nationalIdNumber: employeeProfiles.nationalIdNumber,
      })
      .from(employeeRecords)
      .leftJoin(
        employeeProfiles,
        eq(employeeRecords.employeeProfileId, employeeProfiles.id),
      )
      .where(
        and(
          eq(employeeRecords.companyId, companyId),
          isNull(employeeRecords.deletedAt),
        ),
      )
      .orderBy(desc(employeeRecords.createdAt));

    const blRows = await this.db
      .select()
      .from(employeeBlacklists)
      .where(
        and(
          eq(employeeBlacklists.companyId, companyId),
          eq(employeeBlacklists.status, 'ACTIVE'),
        ),
      );

    const blByRecord = new Map(
      blRows
        .filter((b) => b.employeeRecordId)
        .map((b) => [b.employeeRecordId!, b]),
    );

    const recordIds = rows.map(({ record: r }) => r.id);
    const changeCountByRecord = new Map<string, number>();
    if (recordIds.length) {
      const changeRows = await this.db
        .select({
          employeeRecordId: recordChangeRequests.employeeRecordId,
          total: count(),
        })
        .from(recordChangeRequests)
        .where(
          and(
            eq(recordChangeRequests.companyId, companyId),
            eq(recordChangeRequests.status, 'APPROVED'),
            inArray(recordChangeRequests.employeeRecordId, recordIds),
          ),
        )
        .groupBy(recordChangeRequests.employeeRecordId);
      for (const row of changeRows) {
        if (row.employeeRecordId) {
          changeCountByRecord.set(row.employeeRecordId, Number(row.total));
        }
      }
    }

    return rows.map(({ record: r, nationalIdNumber }) => {
      const bl = blByRecord.get(r.id);
      return {
        id: r.id,
        employeeName: r.employeeName,
        nationalIdNumber,
        employeeIdNumber: r.employeeIdNumber,
        position: r.position,
        hasPhoto: Boolean(r.photoPath),
        joinedAt: r.joinedAt,
        leftAt: r.leftAt,
        hasBlacklist: Boolean(bl),
        blacklistId: bl?.id ?? null,
        blacklistNote: bl?.note ?? null,
        changeRevisionCount: changeCountByRecord.get(r.id) ?? 0,
        createdAt: r.createdAt,
      };
    });
  }

  async disputeSpendReport(companyId: string, actor: JwtPayload) {
    if (actor.roleCode !== 'OWNER' && actor.companyId !== companyId) {
      throw new ForbiddenException();
    }
    await this.access.assertPortalCompanyActive(actor);
    const report = await this.blacklists.spendReport(companyId);
    return {
      totalSpent: report.totalSpent,
      totalSanggahan: report.totalSanggahan,
      activeSanggahan: report.activeSanggahan,
      currency: report.currency,
      blacklists: report.blacklists,
      disputes: report.blacklists.map((b) => ({
        id: b.id,
        status: b.status,
        description: b.note,
        employeeRecordId: b.employeeRecordId,
        employeeName: b.employeeName,
        nationalIdNumber: b.nationalIdNumber,
        position: b.position,
        paymentId: b.paymentId,
        paymentStatus: b.paymentStatus,
        amountIdr: b.amountIdr,
        createdAt: b.createdAt,
      })),
    };
  }

  async inviteLeadership(
    companyId: string,
    actor: JwtPayload,
    dto: InviteLeadershipDto,
  ) {
    const company = await this.db.query.companies.findFirst({
      where: eq(companies.id, companyId),
    });
    if (!company) throw new NotFoundException('PT tidak ditemukan');

    if (actor.roleCode !== 'OWNER') {
      if (actor.companyId !== companyId || actor.roleCode !== 'COMPANY_ADMIN') {
        throw new ForbiddenException('Hanya Admin PT yang dapat mengundang Pimpinan');
      }
    }

    if (company.operationalStatus !== 'ACTIVE') {
      throw new ForbiddenException(
        'Undang Pimpinan hanya setelah perusahaan diverifikasi dan aktif',
      );
    }

    if (company.leaderPublicId) {
      const existingLeader = await this.db.query.users.findFirst({
        where: and(
          eq(users.companyId, companyId),
          eq(users.accountType, 'LEADERSHIP'),
        ),
      });
      if (existingLeader) {
        throw new ConflictException('Akun Pimpinan untuk PT ini sudah ada');
      }
    }

    const leaderEmail = dto.email.toLowerCase();
    const emailTaken = await this.db.query.users.findFirst({
      where: eq(users.email, leaderEmail),
    });
    if (emailTaken) throw new ConflictException('Email sudah digunakan');

    const leaderRole = await this.db.query.roles.findFirst({
      where: eq(roles.code, 'COMPANY_LEADERSHIP'),
    });
    if (!leaderRole) throw new Error('Role pimpinan belum di-seed');

    const leaderPublicId = await this.uniquePublicId('LDR');
    const passwordHash = await bcrypt.hash(generateSecureToken(), 12);

    const leader = await this.db.transaction(async (tx) => {
      await tx
        .update(companies)
        .set({
          leaderPublicId,
          leadershipInvitedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(companies.id, companyId));

      const [row] = await tx
        .insert(users)
        .values({
          publicLoginId: leaderPublicId,
          email: leaderEmail,
          passwordHash,
          fullName: dto.fullName,
          personalPhone: dto.personalPhone,
          accountType: 'LEADERSHIP',
          roleId: leaderRole.id,
          companyId,
        })
        .returning();
      return row;
    });

    await this.mail.sendMail({
      to: leaderEmail,
      subject: 'Undangan Pimpinan WorkRecord',
      html: `
        <p>Anda diundang sebagai <strong>Pimpinan</strong> di ${company.name} pada WorkRecord.</p>
        <p><strong>ID Login:</strong> ${leaderPublicId}</p>
        <p>Silakan atur password dengan kode OTP yang dikirim terpisah ke email, lalu verifikasi email.</p>
      `,
    });

    await this.auth.requestPasswordResetOtp(leaderEmail);
    await this.auth.requestEmailVerification(leader.id);

    await this.audit.log({
      action: 'LEADERSHIP_INVITE',
      actorUserId: actor.sub,
      companyId,
      entityType: 'User',
      entityId: leader.id,
      metadata: { leaderPublicId, email: leaderEmail },
    });

    return {
      leaderPublicId,
      userId: leader.id,
      message: 'Undangan terkirim. Pimpinan atur password via email.',
    };
  }

  private async uniquePublicId(prefix: 'ADM' | 'LDR'): Promise<string> {
    for (let i = 0; i < 10; i++) {
      const id = generatePublicLoginId(prefix);
      const exists = await this.db.query.companies.findFirst({
        where: or(
          eq(companies.adminPublicId, id),
          eq(companies.leaderPublicId, id),
        ),
      });
      const userExists = await this.db.query.users.findFirst({
        where: eq(users.publicLoginId, id),
      });
      if (!exists && !userExists) return id;
    }
    throw new ConflictException('Gagal generate ID unik');
  }

  async findOne(id: string) {
    const company = await this.db.query.companies.findFirst({
      where: eq(companies.id, id),
    });
    if (!company) throw new NotFoundException();
    return company;
  }

  async listForOwner() {
    return this.db
      .select({
        id: companies.id,
        name: companies.name,
        adminPublicId: companies.adminPublicId,
        companyPhone: companies.companyPhone,
        businessField: companies.businessField,
        operationalStatus: companies.operationalStatus,
        surveyStatus: companies.surveyStatus,
        createdAt: companies.createdAt,
      })
      .from(companies)
      .orderBy(asc(companies.name));
  }

  async updateSurvey(
    companyId: string,
    status: 'VERIFIED' | 'REJECTED',
    notes?: string,
    actorUserId?: string,
  ) {
    const [company] = await this.db
      .update(companies)
      .set({
        surveyStatus: status,
        surveyNotes: notes,
        verifiedAt: status === 'VERIFIED' ? new Date() : null,
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
      metadata: { status, notes },
    });

    if (status === 'VERIFIED') {
      const [pendingSub] = await this.db
        .select()
        .from(subscriptions)
        .where(
          and(
            eq(subscriptions.companyId, companyId),
            eq(subscriptions.status, 'PENDING_SURVEY'),
          ),
        )
        .orderBy(desc(subscriptions.createdAt))
        .limit(1);
      if (pendingSub) {
        let months = 1;
        if (pendingSub.paymentId) {
          const pay = await this.db.query.payments.findFirst({
            where: eq(payments.id, pendingSub.paymentId),
          });
          const meta = pay?.metadata;
          if (meta && typeof meta === 'object' && meta !== null && 'months' in meta) {
            months = Number((meta as { months: number }).months);
          }
        }
        const activated = await this.subscriptions.activateAfterSurvey(
          pendingSub.id,
          months,
        );
        await this.audit.log({
          action: 'SUBSCRIPTION_ACTIVATED',
          actorUserId,
          companyId,
          entityType: 'Subscription',
          entityId: activated.id,
          metadata: { months },
        });

        const admin = await this.db.query.users.findFirst({
          where: and(
            eq(users.companyId, companyId),
            eq(users.accountType, 'ADMIN'),
          ),
        });
        if (admin) {
          await this.mail.sendMail({
            to: admin.email,
            subject: 'Langganan aktif — WorkRecord siap digunakan',
            html: `<p>Langganan WorkRecord untuk ${company.name} sudah aktif.</p><p>Pastikan Admin dan Master telah mengaktifkan akun masing-masing agar alur pembuatan dan persetujuan record dapat berjalan.</p>`,
          });
        }
      }
    }

    return company;
  }
}
