import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { and, count, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import {
  auditLogs,
  companies,
  disputes,
  employeeProfiles,
  employeeRecords,
  recordChangeRequests,
  users,
} from '../database/schema';
import { AccessService } from '../access/access.service';
import { JwtPayload } from '../auth/types/jwt-payload';
import { CreateEmployeeRecordDto } from './dto/create-employee-record.dto';
import { UpdateEmployeeRecordDto } from './dto/update-employee-record.dto';
import { AuditService } from '../audit/audit.service';
import { BlacklistsService } from '../blacklists/blacklists.service';
import { compressUploadedImage } from '../common/utils/compress-image';
import { generateWorkRecordPublicId } from '../common/utils/id-generator';
import {
  parseDateOnlyField,
  parseOptionalDateOnlyField,
} from '../common/utils/parse-date-only';
import {
  photoPathFallbackCandidates,
  readFirstExistingFile,
  toRelativeUploadPath,
} from '../common/utils/upload-path';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { randomUUID } from 'crypto';

/** Selaras dengan validasi & kompresi di frontend sebelum upload. */
const EMPLOYEE_PHOTO_MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

@Injectable()
export class EmployeeRecordsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly blacklists: BlacklistsService,
  ) {}

  private get db() {
    return this.database.db;
  }

  private normalizeNik(nik: string): string {
    return nik.replace(/\D/g, '');
  }

  private async nationalIdForRecord(record: {
    employeeProfileId: string | null;
  }): Promise<string | null> {
    if (!record.employeeProfileId) return null;
    const profile = await this.db.query.employeeProfiles.findFirst({
      where: eq(employeeProfiles.id, record.employeeProfileId),
    });
    return profile?.nationalIdNumber ?? null;
  }

  private async upsertEmployeeProfile(input: {
    nationalIdNumber: string;
    fullName: string;
    placeOfBirth: string;
    dateOfBirth: string;
  }) {
    const nik = this.normalizeNik(input.nationalIdNumber);
    if (nik.length !== 16) {
      throw new BadRequestException('NIK KTP wajib 16 digit');
    }
    const existing = await this.db.query.employeeProfiles.findFirst({
      where: eq(employeeProfiles.nationalIdNumber, nik),
    });
    const dob = parseDateOnlyField(input.dateOfBirth, 'Tanggal lahir');
    const place = input.placeOfBirth.trim();
    if (existing) {
      await this.db
        .update(employeeProfiles)
        .set({
          fullName: input.fullName,
          placeOfBirth: place,
          dateOfBirth: dob,
          updatedAt: new Date(),
        })
        .where(eq(employeeProfiles.id, existing.id));
      return existing.id;
    }
    for (let i = 0; i < 8; i++) {
      const publicWorkRecordId = generateWorkRecordPublicId();
      try {
        const [row] = await this.db
          .insert(employeeProfiles)
          .values({
            publicWorkRecordId,
            fullName: input.fullName,
            nationalIdNumber: nik,
            placeOfBirth: place,
            dateOfBirth: dob,
          })
          .returning();
        return row.id;
      } catch {
        /* unique collision on publicWorkRecordId */
      }
    }
    throw new BadRequestException('Gagal membuat profil karyawan');
  }

  private async assertNoDuplicateEmployeeEntry(
    companyId: string,
    nationalIdNumber: string,
    opts?: { excludingRequestId?: string },
  ) {
    const nik = this.normalizeNik(nationalIdNumber);
    const profile = await this.db.query.employeeProfiles.findFirst({
      where: eq(employeeProfiles.nationalIdNumber, nik),
    });
    if (profile) {
      const active = await this.db.query.employeeRecords.findFirst({
        where: and(
          eq(employeeRecords.companyId, companyId),
          eq(employeeRecords.employeeProfileId, profile.id),
          isNull(employeeRecords.deletedAt),
        ),
      });
      if (active) {
        throw new BadRequestException(
          'Karyawan dengan NIK ini sudah terdaftar di perusahaan Anda',
        );
      }
    }

    const pendingCreates = await this.db
      .select()
      .from(recordChangeRequests)
      .where(
        and(
          eq(recordChangeRequests.companyId, companyId),
          eq(recordChangeRequests.action, 'CREATE'),
          eq(recordChangeRequests.status, 'PENDING_APPROVAL'),
        ),
      );
    for (const row of pendingCreates) {
      if (row.id === opts?.excludingRequestId) continue;
      const payload = row.payload as { nationalIdNumber?: string } | null;
      const pendingNik = payload?.nationalIdNumber
        ? this.normalizeNik(payload.nationalIdNumber)
        : '';
      if (pendingNik === nik) {
        throw new BadRequestException(
          'Pengajuan karyawan dengan NIK ini masih menunggu persetujuan',
        );
      }
    }
  }

  private rethrowEmployeeRecordDuplicate(err: unknown): never {
    const code =
      err && typeof err === 'object' && 'code' in err
        ? String((err as { code: unknown }).code)
        : '';
    if (code === '23505') {
      throw new BadRequestException(
        'Karyawan dengan NIK ini sudah terdaftar di perusahaan Anda',
      );
    }
    throw err;
  }

  /** Daftar semua record pekerja (panel admin Owner). */
  async listAllForOwner(user: JwtPayload, limit = 200) {
    if (user.roleCode !== 'OWNER') {
      throw new ForbiddenException('Hanya Owner platform');
    }
    const cap = Math.min(Math.max(limit, 1), 500);
    const rows = await this.db
      .select({
        id: employeeRecords.id,
        companyId: employeeRecords.companyId,
        companyName: companies.name,
        employeeProfileId: employeeRecords.employeeProfileId,
        employeeName: employeeRecords.employeeName,
        employeeIdNumber: employeeRecords.employeeIdNumber,
        position: employeeRecords.position,
        joinedAt: employeeRecords.joinedAt,
        leftAt: employeeRecords.leftAt,
        createdAt: employeeRecords.createdAt,
      })
      .from(employeeRecords)
      .innerJoin(companies, eq(employeeRecords.companyId, companies.id))
      .where(isNull(employeeRecords.deletedAt))
      .orderBy(desc(employeeRecords.createdAt))
      .limit(cap);

    const items = await Promise.all(
      rows.map(async (row) => {
        const nationalId = await this.nationalIdForRecord(row);
        const visibility = await this.blacklists.resolveVisibility(
          row.employeeProfileId ?? null,
          nationalId,
          row.companyId,
        );
        return {
          ...row,
          /** NIK KTP (16 digit) dari profil pekerja — bukan employeeIdNumber internal PT. */
          nationalIdNumber: nationalId,
          hasEmployeeDispute: visibility.hasBlacklist,
        };
      }),
    );

    return { items, limit: cap };
  }

  /** Panel admin Owner — tanpa syarat PT aktif, tampilan operasional. */
  async searchByNikForOwner(user: JwtPayload, nik: string) {
    if (user.roleCode !== 'OWNER') {
      throw new ForbiddenException('Hanya Owner platform');
    }
    return this.searchByNikInternal(nik, user, { ownerView: true });
  }

  async searchByNik(user: JwtPayload, nik: string) {
    const digits = this.normalizeNik(nik);
    if (digits.length !== 16) {
      throw new BadRequestException('NIK KTP wajib 16 digit');
    }

    try {
      await this.access.assertActiveCompanyUser(user);
    } catch {
      throw new ForbiddenException(
        'Hanya perusahaan terverifikasi yang dapat mencari berdasarkan NIK KTP',
      );
    }
    return this.searchByNikInternal(nik, user, { crossCompanyNikSearch: true });
  }

  private async searchByNikInternal(
    nik: string,
    user: JwtPayload,
    opts: { crossCompanyNikSearch?: boolean; ownerView?: boolean },
  ) {
    const digits = this.normalizeNik(nik);
    if (digits.length !== 16) {
      throw new BadRequestException('NIK KTP wajib 16 digit');
    }

    const profile = await this.db.query.employeeProfiles.findFirst({
      where: eq(employeeProfiles.nationalIdNumber, digits),
    });

    if (!profile) {
      return {
        nik: digits,
        nationalIdNumber: digits,
        disputingCompanies: [],
        items: [] as unknown[],
      };
    }

    const matchCondition = eq(employeeRecords.employeeProfileId, profile.id);

    const rows = await this.db
      .select({
        record: employeeRecords,
        companyName: companies.name,
      })
      .from(employeeRecords)
      .innerJoin(companies, eq(employeeRecords.companyId, companies.id))
      .where(and(isNull(employeeRecords.deletedAt), matchCondition))
      .orderBy(desc(employeeRecords.createdAt));

    if (!rows.length) {
      return {
        nik: digits,
        nationalIdNumber: digits,
        disputingCompanies: [],
        items: [] as unknown[],
      };
    }

    const items: unknown[] = [];
    for (const { record, companyName } of rows) {
      const masked = await this.maskRecord(record, user, {
        crossCompanyNikSearch:
          opts.crossCompanyNikSearch || opts.ownerView || false,
      });
      items.push({ ...masked, companyName });
    }

    const profileCounts = new Map<string, number>();
    for (const item of items as { employeeProfileId?: string | null }[]) {
      if (!item.employeeProfileId) continue;
      profileCounts.set(
        item.employeeProfileId,
        (profileCounts.get(item.employeeProfileId) ?? 0) + 1,
      );
    }

    const disputingCompanies =
      await this.blacklists.listActiveDisputeSources(profile.id, digits);

    return {
      nik: digits,
      nationalIdNumber: digits,
      disputingCompanies,
      items: (items as { employeeProfileId?: string | null }[]).map(
        (item) => ({
          ...item,
          registeredCompanyCount: item.employeeProfileId
            ? profileCounts.get(item.employeeProfileId) ?? 1
            : 1,
        }),
      ),
    };
  }

  async list(companyId: string, user?: JwtPayload) {
    const records = await this.db
      .select()
      .from(employeeRecords)
      .where(
        and(
          eq(employeeRecords.companyId, companyId),
          isNull(employeeRecords.deletedAt),
        ),
      )
      .orderBy(desc(employeeRecords.createdAt));

    return Promise.all(
      records.map((r) => this.maskRecord(r, user)),
    );
  }

  async getOne(
    companyId: string,
    id: string,
    user?: JwtPayload,
  ) {
    const record = await this.db.query.employeeRecords.findFirst({
      where: and(
        eq(employeeRecords.id, id),
        eq(employeeRecords.companyId, companyId),
        isNull(employeeRecords.deletedAt),
      ),
    });
    if (!record) throw new NotFoundException();
    return this.maskRecord(record, user);
  }

  private async hasOpenEmployeeDispute(employeeRecordId: string): Promise<boolean> {
    const open = await this.db.query.disputes.findFirst({
      where: and(
        eq(disputes.employeeRecordId, employeeRecordId),
        inArray(disputes.status, ['OPEN', 'INVESTIGATING']),
      ),
    });
    return Boolean(open);
  }

  private async maskRecord(
    record: {
      id: string;
      companyId: string;
      employeeProfileId: string | null;
      employeeName: string;
      employeeIdNumber: string | null;
      position: string | null;
      photoPath?: string | null;
      joinedAt: Date | null;
      leftAt: Date | null;
      conductSummary: string | null;
      violationNotes: string | null;
      createdAt: Date;
      updatedAt: Date;
    },
    user?: JwtPayload,
    options?: { crossCompanyNikSearch?: boolean },
  ) {
    const visibility = await this.access.canViewRecord(
      record.companyId,
      record.id,
      user,
      options,
    );

    if (visibility === 'denied') {
      throw new NotFoundException();
    }

    const profile = record.employeeProfileId
      ? await this.db.query.employeeProfiles.findFirst({
          where: eq(employeeProfiles.id, record.employeeProfileId),
        })
      : null;

    const nationalId = profile?.nationalIdNumber ?? null;
    const displayName = profile?.fullName ?? record.employeeName;
    const bl = await this.blacklists.resolveVisibility(
      record.employeeProfileId,
      nationalId,
      user?.companyId,
    );
    const recordDispute =
      await this.blacklists.getActiveDisputeForRecord(record.id);

    const identity = {
      employeeProfileId: record.employeeProfileId,
      publicWorkRecordId: profile?.publicWorkRecordId ?? null,
      hasBlacklist: bl.hasBlacklist,
      blacklistedByViewerCompany: bl.blacklistedByViewerCompany,
      blacklistNote: bl.blacklistNote,
      hasEmployeeDispute: bl.hasBlacklist,
      disputedByEmployer: Boolean(recordDispute),
      disputedByCompanyId: recordDispute?.companyId ?? null,
      disputedByCompanyName: recordDispute?.companyName ?? null,
    };

    return {
      ...record,
      ...identity,
      employeeName: displayName,
      nationalIdNumber: nationalId,
      employeeIdNumber: record.employeeIdNumber,
      placeOfBirth: profile?.placeOfBirth ?? null,
      dateOfBirth: profile?.dateOfBirth
        ? profile.dateOfBirth.toISOString().slice(0, 10)
        : null,
      position: record.position,
      joinedAt: record.joinedAt
        ? record.joinedAt.toISOString().slice(0, 10)
        : null,
      leftAt: record.leftAt
        ? record.leftAt.toISOString().slice(0, 10)
        : null,
      hasPhoto: Boolean(record.photoPath),
      visibility: 'full' as const,
    };
  }

  private blurText(value: string): string {
    if (value.length <= 2) return '*';
    return value[0] + '*'.repeat(value.length - 2) + value[value.length - 1];
  }

  private blurNik(value: string): string {
    const digits = value.replace(/\D/g, '');
    if (digits.length < 4) return '••••';
    return `${digits.slice(0, 4)}••••••••${digits.slice(-4)}`;
  }

  private blurBirthDate(value: Date): string {
    return `••/••/${value.getFullYear()}`;
  }

  private uploadRoot() {
    return process.env.UPLOAD_DIR ?? join(process.cwd(), 'uploads');
  }

  private assertEmployeePhotoUploadSize(file: { buffer: Buffer }) {
    if (file.buffer.length > EMPLOYEE_PHOTO_MAX_UPLOAD_BYTES) {
      throw new BadRequestException('Ukuran foto maksimal 5 MB');
    }
  }

  private async saveEmployeePhoto(
    companyId: string,
    recordId: string,
    file: { buffer: Buffer; mimetype: string },
  ): Promise<string> {
    this.assertEmployeePhotoUploadSize(file);
    const compressed = await compressUploadedImage(file, {
      maxEdge: 1200,
      quality: 82,
    });
    const dir = join(this.uploadRoot(), 'employees', companyId, recordId);
    await mkdir(dir, { recursive: true });
    const filePath = join(dir, `photo.${compressed.extension}`);
    await writeFile(filePath, compressed.buffer);
    return toRelativeUploadPath(this.uploadRoot(), filePath);
  }

  private async saveStagingPhoto(
    file: { buffer: Buffer; mimetype: string },
  ): Promise<string> {
    this.assertEmployeePhotoUploadSize(file);
    const compressed = await compressUploadedImage(file, {
      maxEdge: 1200,
      quality: 82,
    });
    const dir = join(this.uploadRoot(), 'employees', 'staging');
    await mkdir(dir, { recursive: true });
    const filePath = join(dir, `${randomUUID()}.${compressed.extension}`);
    await writeFile(filePath, compressed.buffer);
    return toRelativeUploadPath(this.uploadRoot(), filePath);
  }

  async readPhotoFile(companyId: string, recordId: string, user: JwtPayload) {
    const record = await this.db.query.employeeRecords.findFirst({
      where: and(
        eq(employeeRecords.id, recordId),
        eq(employeeRecords.companyId, companyId),
        isNull(employeeRecords.deletedAt),
      ),
    });
    if (!record?.photoPath) throw new NotFoundException();
    const sameCompany = user.companyId === companyId;
    const visibility = await this.access.canViewRecord(
      companyId,
      recordId,
      user,
      sameCompany ? undefined : { crossCompanyNikSearch: true },
    );
    if (visibility === 'denied') throw new NotFoundException();

    const root = this.uploadRoot();
    const candidates = photoPathFallbackCandidates(root, record.photoPath);
    const found = await readFirstExistingFile(candidates);
    if (!found) {
      throw new NotFoundException('Foto karyawan tidak ditemukan di server');
    }
    const ext = found.path.split('.').pop()?.toLowerCase();
    const mime =
      ext === 'png'
        ? 'image/png'
        : ext === 'webp'
          ? 'image/webp'
          : 'image/jpeg';
    return { data: found.data, mime };
  }

  async create(
    companyId: string,
    user: JwtPayload,
    dto: CreateEmployeeRecordDto,
    photo?: { buffer: Buffer; mimetype: string },
  ) {
    dto.nationalIdNumber = this.normalizeNik(dto.nationalIdNumber);
    if (dto.nationalIdNumber.length !== 16) {
      throw new BadRequestException('NIK KTP wajib 16 digit');
    }

    const gate = await this.access.canCrudRecords(user, companyId);
    if (!gate.allowed) {
      const msg =
        gate.reason === 'company_not_active'
          ? 'Perusahaan belum aktif. Selesaikan verifikasi dokumen di menu Verifikasi.'
          : (gate.reason ?? 'Tidak diizinkan');
      throw new ForbiddenException(msg);
    }
    if (!photo?.buffer?.length) {
      throw new BadRequestException('Foto karyawan wajib diunggah');
    }
    if (!dto.position?.trim()) {
      throw new BadRequestException('Posisi/jabatan wajib diisi');
    }
    if (!dto.placeOfBirth?.trim() || dto.placeOfBirth.trim().length < 2) {
      throw new BadRequestException('Tempat lahir wajib diisi (min. 2 karakter)');
    }

    await this.assertNoDuplicateEmployeeEntry(companyId, dto.nationalIdNumber);

    const payload: CreateEmployeeRecordDto & { photoStagingPath?: string } = {
      ...dto,
    };
    if (photo) {
      payload.photoStagingPath = await this.saveStagingPhoto(photo);
    }

    if (gate.needsApproval) {
      const [req] = await this.db
        .insert(recordChangeRequests)
        .values({
          companyId,
          action: 'CREATE',
          status: 'PENDING_APPROVAL',
          payload,
          requestedById: user.sub,
        })
        .returning();
      await this.audit.log({
        action: 'RECORD_CREATE',
        actorUserId: user.sub,
        companyId,
        entityType: 'RecordChangeRequest',
        entityId: req.id,
        metadata: { pendingApproval: true },
      });
      return req;
    }

    const profileId = await this.upsertEmployeeProfile({
      nationalIdNumber: dto.nationalIdNumber,
      fullName: dto.employeeName,
      placeOfBirth: dto.placeOfBirth,
      dateOfBirth: dto.dateOfBirth,
    });
    const employeeCode = dto.employeeCode?.trim() || null;
    const joinedAt = parseDateOnlyField(dto.joinedAt, 'Tanggal mulai kerja');
    const leftAt = parseOptionalDateOnlyField(
      dto.leftAt,
      'Tanggal selesai kerja',
    );
    if (leftAt && leftAt < joinedAt) {
      throw new BadRequestException(
        'Tanggal selesai kerja tidak boleh sebelum tanggal mulai',
      );
    }

    let created: typeof employeeRecords.$inferSelect;
    try {
      [created] = await this.db
        .insert(employeeRecords)
        .values({
          companyId,
          employeeProfileId: profileId,
          employeeName: dto.employeeName,
          employeeIdNumber: employeeCode,
          position: dto.position.trim(),
          conductSummary: dto.conductSummary,
          joinedAt,
          leftAt,
          isPublicPreview: false,
        })
        .returning();
    } catch (err) {
      this.rethrowEmployeeRecordDuplicate(err);
    }

    const photoPath = await this.saveEmployeePhoto(companyId, created.id, photo);
    const [withPhoto] = await this.db
      .update(employeeRecords)
      .set({ photoPath, updatedAt: new Date() })
      .where(eq(employeeRecords.id, created.id))
      .returning();

    await this.audit.log({
      action: 'RECORD_CREATE',
      actorUserId: user.sub,
      companyId,
      entityType: 'EmployeeRecord',
      entityId: created.id,
    });
    return withPhoto;
  }

  async update(
    companyId: string,
    id: string,
    user: JwtPayload,
    dto: UpdateEmployeeRecordDto,
  ) {
    const gate = await this.access.canCrudRecords(user, companyId);
    if (!gate.allowed) throw new ForbiddenException(gate.reason);

    const normalized = { ...dto };
    if (normalized.nationalIdNumber) {
      normalized.nationalIdNumber = this.normalizeNik(normalized.nationalIdNumber);
    }
    const payload: UpdateEmployeeRecordDto & { id: string; photoStagingPath?: string } = {
      id,
      ...normalized,
    };

    if (gate.needsApproval) {
      const [req] = await this.db
        .insert(recordChangeRequests)
        .values({
          companyId,
          employeeRecordId: id,
          action: 'UPDATE',
          status: 'PENDING_APPROVAL',
          payload,
          requestedById: user.sub,
        })
        .returning();
      await this.audit.log({
        action: 'RECORD_UPDATE',
        actorUserId: user.sub,
        companyId,
        entityType: 'RecordChangeRequest',
        entityId: req.id,
        metadata: { employeeRecordId: id, pendingApproval: true },
      });
      return req;
    }

    await this.applyRecordUpdate(companyId, id, dto);
    const updated = await this.getOne(companyId, id, user);
    await this.audit.log({
      action: 'RECORD_UPDATE',
      actorUserId: user.sub,
      companyId,
      entityType: 'EmployeeRecord',
      entityId: id,
    });
    return updated;
  }

  async updateWithPhoto(
    companyId: string,
    id: string,
    user: JwtPayload,
    dto: UpdateEmployeeRecordDto,
    photo?: { buffer: Buffer; mimetype: string },
  ) {
    const gate = await this.access.canCrudRecords(user, companyId);
    if (!gate.allowed) throw new ForbiddenException(gate.reason);

    const normalized = { ...dto };
    if (normalized.nationalIdNumber) {
      normalized.nationalIdNumber = this.normalizeNik(normalized.nationalIdNumber);
    }
    const payload: UpdateEmployeeRecordDto & {
      id: string;
      photoStagingPath?: string;
    } = { id, ...normalized };

    if (photo?.buffer?.length) {
      payload.photoStagingPath = await this.saveStagingPhoto(photo);
    }

    if (gate.needsApproval) {
      const [req] = await this.db
        .insert(recordChangeRequests)
        .values({
          companyId,
          employeeRecordId: id,
          action: 'UPDATE',
          status: 'PENDING_APPROVAL',
          payload,
          requestedById: user.sub,
        })
        .returning();
      await this.audit.log({
        action: 'RECORD_UPDATE',
        actorUserId: user.sub,
        companyId,
        entityType: 'RecordChangeRequest',
        entityId: req.id,
        metadata: { employeeRecordId: id, pendingApproval: true },
      });
      return req;
    }

    if (photo?.buffer?.length) {
      const photoPath = await this.saveEmployeePhoto(companyId, id, photo);
      await this.db
        .update(employeeRecords)
        .set({ photoPath, updatedAt: new Date() })
        .where(eq(employeeRecords.id, id));
    }
    await this.applyRecordUpdate(companyId, id, dto);
    return this.getOne(companyId, id, user);
  }

  private async applyRecordUpdate(
    companyId: string,
    id: string,
    dto: UpdateEmployeeRecordDto & { photoStagingPath?: string },
  ) {
    const record = await this.db.query.employeeRecords.findFirst({
      where: and(
        eq(employeeRecords.id, id),
        eq(employeeRecords.companyId, companyId),
        isNull(employeeRecords.deletedAt),
      ),
    });
    if (!record) throw new NotFoundException();

    if (
      dto.nationalIdNumber ||
      dto.placeOfBirth ||
      dto.dateOfBirth ||
      dto.employeeName
    ) {
      const profileId = record.employeeProfileId;
      if (profileId) {
        const profile = await this.db.query.employeeProfiles.findFirst({
          where: eq(employeeProfiles.id, profileId),
        });
        if (profile) {
          await this.db
            .update(employeeProfiles)
            .set({
              nationalIdNumber: dto.nationalIdNumber
                ? this.normalizeNik(dto.nationalIdNumber)
                : profile.nationalIdNumber,
              fullName: dto.employeeName ?? profile.fullName,
              placeOfBirth: dto.placeOfBirth?.trim() ?? profile.placeOfBirth,
              dateOfBirth: dto.dateOfBirth
                ? parseDateOnlyField(dto.dateOfBirth, 'Tanggal lahir')
                : profile.dateOfBirth,
              updatedAt: new Date(),
            })
            .where(eq(employeeProfiles.id, profileId));
        }
      } else if (dto.nationalIdNumber && dto.employeeName && dto.placeOfBirth && dto.dateOfBirth) {
        const newProfileId = await this.upsertEmployeeProfile({
          nationalIdNumber: dto.nationalIdNumber,
          fullName: dto.employeeName,
          placeOfBirth: dto.placeOfBirth,
          dateOfBirth: dto.dateOfBirth,
        });
        await this.db
          .update(employeeRecords)
          .set({ employeeProfileId: newProfileId, updatedAt: new Date() })
          .where(eq(employeeRecords.id, id));
      }
    }

    const patch: Partial<typeof employeeRecords.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (dto.employeeName !== undefined) patch.employeeName = dto.employeeName;
    if (dto.employeeIdNumber !== undefined) {
      patch.employeeIdNumber = dto.employeeIdNumber;
    }
    if (dto.position !== undefined) patch.position = dto.position;
    if (dto.conductSummary !== undefined) {
      patch.conductSummary = dto.conductSummary;
    }
    if (dto.violationNotes !== undefined) {
      patch.violationNotes = dto.violationNotes;
    }
    if (dto.joinedAt !== undefined) {
      patch.joinedAt = parseDateOnlyField(dto.joinedAt, 'Tanggal mulai kerja');
    }
    if (dto.leftAt !== undefined) {
      patch.leftAt = parseOptionalDateOnlyField(
        dto.leftAt,
        'Tanggal selesai kerja',
      );
    }

    await this.db
      .update(employeeRecords)
      .set(patch)
      .where(eq(employeeRecords.id, id));

    if (dto.photoStagingPath) {
      const data = await readFile(dto.photoStagingPath);
      const mimetype = dto.photoStagingPath.endsWith('.png')
        ? 'image/png'
        : dto.photoStagingPath.endsWith('.webp')
          ? 'image/webp'
          : 'image/jpeg';
      const photoPath = await this.saveEmployeePhoto(companyId, id, {
        buffer: data,
        mimetype,
      });
      await this.db
        .update(employeeRecords)
        .set({ photoPath, updatedAt: new Date() })
        .where(eq(employeeRecords.id, id));
    }
  }

  async softDelete(companyId: string, id: string, user: JwtPayload) {
    const gate = await this.access.canCrudRecords(user, companyId);
    if (!gate.allowed) {
      const msg =
        gate.reason === 'company_not_active'
          ? 'Perusahaan belum aktif'
          : (gate.reason ?? 'Tidak diizinkan');
      throw new ForbiddenException(msg);
    }

    const actor = await this.db.query.users.findFirst({
      where: eq(users.id, user.sub),
    });
    if (!actor) throw new NotFoundException();
    if (user.roleCode !== 'OWNER' && actor.accountType !== 'LEADERSHIP') {
      throw new ForbiddenException(
        'Hanya akun Pimpinan (Master) yang dapat menghapus data karyawan',
      );
    }

    const existing = await this.db.query.employeeRecords.findFirst({
      where: and(
        eq(employeeRecords.id, id),
        eq(employeeRecords.companyId, companyId),
        isNull(employeeRecords.deletedAt),
      ),
    });
    if (!existing) throw new NotFoundException('Data karyawan tidak ditemukan');

    const [deleted] = await this.db
      .update(employeeRecords)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(employeeRecords.id, id))
      .returning();
    await this.audit.log({
      action: 'RECORD_DELETE',
      actorUserId: user.sub,
      companyId,
      entityType: 'EmployeeRecord',
      entityId: id,
    });
    return deleted;
  }

  async listDeletedHistory(companyId: string, user: JwtPayload) {
    if (user.roleCode !== 'OWNER' && user.companyId !== companyId) {
      throw new ForbiddenException();
    }
    await this.access.assertPortalCompanyActive(user);

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
          isNotNull(employeeRecords.deletedAt),
        ),
      )
      .orderBy(desc(employeeRecords.deletedAt))
      .limit(200);

    const recordIds = rows.map(({ record: r }) => r.id);
    const deletedByMap = new Map<
      string,
      { fullName: string; publicLoginId: string }
    >();

    if (recordIds.length) {
      const logs = await this.db
        .select({
          entityId: auditLogs.entityId,
          actorUserId: auditLogs.actorUserId,
          createdAt: auditLogs.createdAt,
        })
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.companyId, companyId),
            eq(auditLogs.action, 'RECORD_DELETE'),
            eq(auditLogs.entityType, 'EmployeeRecord'),
            inArray(auditLogs.entityId, recordIds),
          ),
        )
        .orderBy(desc(auditLogs.createdAt));

      const actorIds = [
        ...new Set(logs.map((l) => l.actorUserId).filter(Boolean) as string[]),
      ];
      const actors =
        actorIds.length > 0
          ? await this.db
              .select({
                id: users.id,
                fullName: users.fullName,
                publicLoginId: users.publicLoginId,
              })
              .from(users)
              .where(inArray(users.id, actorIds))
          : [];
      const actorById = new Map(actors.map((a) => [a.id, a]));

      for (const log of logs) {
        if (!log.entityId || deletedByMap.has(log.entityId)) continue;
        const u = log.actorUserId ? actorById.get(log.actorUserId) : undefined;
        if (u) {
          deletedByMap.set(log.entityId, {
            fullName: u.fullName,
            publicLoginId: u.publicLoginId,
          });
        }
      }
    }

    return {
      items: rows.map(({ record: r, nationalIdNumber }) => ({
        id: r.id,
        employeeName: r.employeeName,
        nationalIdNumber,
        position: r.position,
        joinedAt: r.joinedAt,
        leftAt: r.leftAt,
        deletedAt: r.deletedAt,
        deletedBy: deletedByMap.get(r.id) ?? null,
      })),
    };
  }

  async approveChange(requestId: string, leader: JwtPayload) {
    const req = await this.db.query.recordChangeRequests.findFirst({
      where: eq(recordChangeRequests.id, requestId),
    });
    if (!req) throw new NotFoundException();
    if (req.status !== 'PENDING_APPROVAL') {
      throw new ForbiddenException('Request sudah diproses');
    }

    const leaderUser = await this.db.query.users.findFirst({
      where: eq(users.id, leader.sub),
    });
    if (!leaderUser) throw new NotFoundException();
    if (
      leaderUser.accountType !== 'LEADERSHIP' &&
      leader.roleCode !== 'OWNER'
    ) {
      throw new ForbiddenException('Hanya pimpinan yang dapat approve');
    }

    if (req.action === 'CREATE') {
      const p = req.payload as unknown as CreateEmployeeRecordDto & {
        photoStagingPath?: string;
      };
      await this.assertNoDuplicateEmployeeEntry(req.companyId, p.nationalIdNumber, {
        excludingRequestId: requestId,
      });
      const profileId = await this.upsertEmployeeProfile({
        nationalIdNumber: p.nationalIdNumber,
        fullName: p.employeeName,
        placeOfBirth: p.placeOfBirth,
        dateOfBirth: p.dateOfBirth,
      });
      const employeeCode = p.employeeCode?.trim() || null;
      const joinedAt = parseDateOnlyField(p.joinedAt, 'Tanggal mulai kerja');
      const leftAt = parseOptionalDateOnlyField(
        p.leftAt,
        'Tanggal selesai kerja',
      );
      if (leftAt && leftAt < joinedAt) {
        throw new BadRequestException(
          'Tanggal selesai kerja tidak boleh sebelum tanggal mulai',
        );
      }
      let created: typeof employeeRecords.$inferSelect;
      try {
        [created] = await this.db
          .insert(employeeRecords)
          .values({
            companyId: req.companyId,
            employeeProfileId: profileId,
            employeeName: p.employeeName,
            employeeIdNumber: employeeCode,
            position: p.position,
            conductSummary: p.conductSummary,
            joinedAt,
            leftAt,
            isPublicPreview: false,
          })
          .returning();
      } catch (err) {
        this.rethrowEmployeeRecordDuplicate(err);
      }
      if (p.photoStagingPath) {
        const data = await readFile(p.photoStagingPath);
        const mimetype =
          p.photoStagingPath.endsWith('.png')
            ? 'image/png'
            : p.photoStagingPath.endsWith('.webp')
              ? 'image/webp'
              : 'image/jpeg';
        const photoPath = await this.saveEmployeePhoto(
          req.companyId,
          created.id,
          { buffer: data, mimetype },
        );
        await this.db
          .update(employeeRecords)
          .set({ photoPath, updatedAt: new Date() })
          .where(eq(employeeRecords.id, created.id));
      }
      await this.db
        .update(recordChangeRequests)
        .set({ employeeRecordId: created.id, updatedAt: new Date() })
        .where(eq(recordChangeRequests.id, requestId));
    } else if (req.action === 'UPDATE') {
      const p = req.payload as unknown as UpdateEmployeeRecordDto & {
        id: string;
        photoStagingPath?: string;
      };
      await this.applyRecordUpdate(req.companyId, p.id, p);
    } else if (req.action === 'DELETE') {
      const p = req.payload as unknown as { id: string };
      await this.db
        .update(employeeRecords)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(employeeRecords.id, p.id));
    }

    const [updatedReq] = await this.db
      .update(recordChangeRequests)
      .set({
        status: 'APPROVED',
        approvedById: leader.sub,
        appliedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(recordChangeRequests.id, requestId))
      .returning();
    await this.audit.log({
      action: 'RECORD_CHANGE_APPROVED',
      actorUserId: leader.sub,
      companyId: req.companyId,
      entityType: 'RecordChangeRequest',
      entityId: requestId,
      metadata: { action: req.action },
    });
    return updatedReq;
  }

  async listPendingApprovals(companyId: string) {
    return this.enrichChangeRequests(
      await this.db
        .select()
        .from(recordChangeRequests)
        .where(
          and(
            eq(recordChangeRequests.companyId, companyId),
            eq(recordChangeRequests.status, 'PENDING_APPROVAL'),
          ),
        )
        .orderBy(desc(recordChangeRequests.createdAt)),
    );
  }

  async listRejectedApprovals(companyId: string, user: JwtPayload) {
    const gate = await this.access.canCrudRecords(user, companyId);
    if (!gate.allowed) throw new ForbiddenException(gate.reason);
    return this.enrichChangeRequests(
      await this.db
        .select()
        .from(recordChangeRequests)
        .where(
          and(
            eq(recordChangeRequests.companyId, companyId),
            eq(recordChangeRequests.status, 'REJECTED'),
          ),
        )
        .orderBy(desc(recordChangeRequests.updatedAt))
        .limit(100),
    );
  }

  async getApprovalRequest(companyId: string, requestId: string, user: JwtPayload) {
    const req = await this.db.query.recordChangeRequests.findFirst({
      where: and(
        eq(recordChangeRequests.id, requestId),
        eq(recordChangeRequests.companyId, companyId),
      ),
    });
    if (!req) throw new NotFoundException();
    const sameCompany = user.companyId === companyId;
    if (!sameCompany && user.roleCode !== 'OWNER') {
      throw new ForbiddenException();
    }
    const [enriched] = await this.enrichChangeRequests([req]);
    return enriched;
  }

  private async enrichChangeRequests(
    rows: (typeof recordChangeRequests.$inferSelect)[],
  ) {
    if (!rows.length) return [];
    const userIds = [
      ...new Set(
        rows.flatMap((r) =>
          [r.requestedById, r.approvedById].filter(Boolean) as string[],
        ),
      ),
    ];
    const actors =
      userIds.length > 0
        ? await this.db
            .select({
              id: users.id,
              fullName: users.fullName,
              publicLoginId: users.publicLoginId,
              accountType: users.accountType,
            })
            .from(users)
            .where(inArray(users.id, userIds))
        : [];
    const byId = new Map(actors.map((a) => [a.id, a]));
    return rows.map((r) => ({
      ...r,
      requestedBy: byId.get(r.requestedById) ?? null,
      processedBy: r.approvedById ? byId.get(r.approvedById) ?? null : null,
    }));
  }

  async rejectChange(
    requestId: string,
    leader: JwtPayload,
    rejectionReason: string,
  ) {
    const req = await this.db.query.recordChangeRequests.findFirst({
      where: eq(recordChangeRequests.id, requestId),
    });
    if (!req) throw new NotFoundException();
    if (req.status !== 'PENDING_APPROVAL') {
      throw new ForbiddenException('Request sudah diproses');
    }

    const leaderUser = await this.db.query.users.findFirst({
      where: eq(users.id, leader.sub),
    });
    if (!leaderUser) throw new NotFoundException();
    if (
      leaderUser.accountType !== 'LEADERSHIP' &&
      leader.roleCode !== 'OWNER'
    ) {
      throw new ForbiddenException('Hanya pimpinan yang dapat menolak');
    }

    const reason = rejectionReason.trim();
    if (reason.length < 5) {
      throw new BadRequestException(
        'Alasan penolakan wajib diisi (min. 5 karakter)',
      );
    }

    const [updatedReq] = await this.db
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
      companyId: req.companyId,
      entityType: 'RecordChangeRequest',
      entityId: requestId,
      metadata: { action: req.action, rejectionReason: reason },
    });
    return updatedReq;
  }

  async getChangeHistory(
    companyId: string,
    recordId: string,
    user: JwtPayload,
  ) {
    await this.getOne(companyId, recordId, user);
    const rows = await this.db
      .select()
      .from(recordChangeRequests)
      .where(
        and(
          eq(recordChangeRequests.companyId, companyId),
          eq(recordChangeRequests.employeeRecordId, recordId),
        ),
      )
      .orderBy(desc(recordChangeRequests.createdAt));

    const enriched = await this.enrichChangeRequests(rows);
    const changeCount = enriched.filter((r) => r.status === 'APPROVED').length;
    return { changeCount, items: enriched };
  }

  async countApprovedChangesForRecords(
    companyId: string,
    recordIds: string[],
  ): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    if (!recordIds.length) return map;
    const rows = await this.db
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
    for (const row of rows) {
      if (row.employeeRecordId) {
        map.set(row.employeeRecordId, Number(row.total));
      }
    }
    return map;
  }
}
