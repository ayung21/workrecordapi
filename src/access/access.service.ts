import { ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq, isNull } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import { companies, employeeRecords, users } from '../database/schema';
import { JwtPayload } from '../auth/types/jwt-payload';

export type RecordVisibility = 'full' | 'denied';

@Injectable()
export class AccessService {
  constructor(
    private readonly database: DatabaseService,
    private readonly config: ConfigService,
  ) {}

  private isDevUnrestrictedView(): boolean {
    return (
      this.config.get<string>('RECORDS_DEV_UNRESTRICTED_VIEW', 'false') ===
      'true'
    );
  }

  private get db() {
    return this.database.db;
  }

  isOwner(user?: JwtPayload): boolean {
    return user?.roleCode === 'OWNER';
  }

  async isCompanyOperational(companyId: string): Promise<boolean> {
    const company = await this.db.query.companies.findFirst({
      where: eq(companies.id, companyId),
    });
    return company?.operationalStatus === 'ACTIVE';
  }

  async assertActiveCompanyUser(user: JwtPayload): Promise<string> {
    if (this.isOwner(user)) {
      throw new Error('Owner uses admin tools');
    }
    if (!user.companyId) {
      throw new Error('not_company_user');
    }
    const ok = await this.isCompanyOperational(user.companyId);
    if (!ok) throw new Error('company_not_active');
    return user.companyId;
  }

  /** Portal perusahaan: Cari NIK KTP, list, report, iklan, blacklist — hanya jika ACTIVE. */
  async assertPortalCompanyActive(user: JwtPayload): Promise<void> {
    if (this.isOwner(user)) return;
    if (!user.companyId) {
      throw new ForbiddenException('Bukan akun perusahaan');
    }
    const ok = await this.isCompanyOperational(user.companyId);
    if (!ok) {
      throw new ForbiddenException(
        'Perusahaan belum diverifikasi admin WorkRecord. Selesaikan verifikasi dokumen dan tunggu aktivasi.',
      );
    }
  }

  async canViewRecord(
    companyId: string,
    employeeRecordId: string,
    user?: JwtPayload,
    options?: { crossCompanyNikSearch?: boolean },
  ): Promise<RecordVisibility> {
    if (this.isDevUnrestrictedView()) return 'full';
    if (user && this.isOwner(user)) return 'full';

    if (user?.companyId) {
      const viewerActive = await this.isCompanyOperational(user.companyId);
      if (!viewerActive) return 'denied';

      if (user.companyId === companyId) return 'full';

      if (options?.crossCompanyNikSearch) return 'full';
    }

    return 'denied';
  }

  async canCrudRecords(
    user: JwtPayload,
    companyId: string,
  ): Promise<{ allowed: boolean; needsApproval: boolean; reason?: string }> {
    if (this.isOwner(user)) {
      return { allowed: true, needsApproval: false };
    }

    if (user.companyId !== companyId) {
      return { allowed: false, needsApproval: false, reason: 'wrong_company' };
    }

    const active = await this.isCompanyOperational(companyId);
    if (!active) {
      return { allowed: false, needsApproval: false, reason: 'company_not_active' };
    }

    const dbUser = await this.db.query.users.findFirst({
      where: eq(users.id, user.sub),
    });
    if (!dbUser) {
      return { allowed: false, needsApproval: false, reason: 'user_not_found' };
    }

    if (dbUser.accountType === 'LEADERSHIP') {
      return { allowed: true, needsApproval: false };
    }
    if (dbUser.accountType === 'ADMIN') {
      return { allowed: true, needsApproval: true };
    }

    return { allowed: false, needsApproval: false, reason: 'forbidden' };
  }
}
