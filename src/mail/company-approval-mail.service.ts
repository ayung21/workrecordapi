import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import {
  companies,
  employeeRecords,
  users,
} from '../database/schema';
import { MailService } from './mail.service';

type LeadershipApprovalAction = 'CREATE' | 'UPDATE' | 'BLACKLIST';

const ACTION_LABEL: Record<
  LeadershipApprovalAction,
  { noun: string; verb: string }
> = {
  CREATE: {
    noun: 'penambahan data karyawan',
    verb: 'menambahkan data karyawan baru',
  },
  UPDATE: {
    noun: 'perubahan data karyawan',
    verb: 'mengubah data karyawan',
  },
  BLACKLIST: {
    noun: 'pengajuan sanggahan karyawan',
    verb: 'mengajukan sanggahan (blacklist) terhadap karyawan',
  },
};

@Injectable()
export class CompanyApprovalMailService {
  private readonly logger = new Logger(CompanyApprovalMailService.name);

  constructor(
    private readonly mail: MailService,
    private readonly config: ConfigService,
    private readonly database: DatabaseService,
  ) {}

  private get db() {
    return this.database.db;
  }

  private async safeSend(task: () => Promise<void>, context: string): Promise<void> {
    try {
      await task();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Gagal kirim email persetujuan pimpinan (${context}): ${message}`,
      );
    }
  }

  private async leadershipRecipients(companyId: string) {
    return this.db.query.users.findMany({
      where: and(
        eq(users.companyId, companyId),
        eq(users.isActive, true),
        eq(users.accountType, 'LEADERSHIP'),
      ),
      columns: { email: true, fullName: true },
    });
  }

  private async employeeDisplayName(
    companyId: string,
    employeeRecordId: string | null | undefined,
    payload: unknown,
  ): Promise<string> {
    const p = payload as Record<string, unknown> | null;
    if (typeof p?.employeeName === 'string' && p.employeeName.trim()) {
      return p.employeeName.trim();
    }
    if (!employeeRecordId) return 'Karyawan';
    const rec = await this.db.query.employeeRecords.findFirst({
      where: and(
        eq(employeeRecords.id, employeeRecordId),
        eq(employeeRecords.companyId, companyId),
      ),
      columns: { employeeName: true },
    });
    return rec?.employeeName?.trim() || 'Karyawan';
  }

  /** Admin mengajukan CREATE/UPDATE/BLACKLIST — email ke semua akun Pimpinan PT. */
  async notifyLeadershipChangeRequest(input: {
    companyId: string;
    requestId: string;
    action: LeadershipApprovalAction;
    requestedByUserId: string;
    employeeRecordId?: string | null;
    payload: unknown;
  }): Promise<void> {
    const leaders = await this.leadershipRecipients(input.companyId);
    if (leaders.length === 0) {
      this.logger.warn(
        `Tidak ada akun Pimpinan aktif untuk company ${input.companyId} — email persetujuan tidak terkirim.`,
      );
      return;
    }

    const [company, requester, employeeName] = await Promise.all([
      this.db.query.companies.findFirst({
        where: eq(companies.id, input.companyId),
        columns: { name: true },
      }),
      this.db.query.users.findFirst({
        where: eq(users.id, input.requestedByUserId),
        columns: { fullName: true, publicLoginId: true },
      }),
      this.employeeDisplayName(
        input.companyId,
        input.employeeRecordId,
        input.payload,
      ),
    ]);

    const label = ACTION_LABEL[input.action];
    const companyName = company?.name ?? 'Perusahaan Anda';
    const adminName = requester?.fullName?.trim() || 'Admin';
    const adminLogin = requester?.publicLoginId ?? '—';
    const appUrl = this.config
      .get<string>('APP_URL', 'http://localhost:3008')
      .replace(/\/$/, '');
    const portalUrl = `${appUrl}/perusahaan/list`;

    let extra = '';
    if (input.action === 'BLACKLIST') {
      const note =
        typeof (input.payload as { note?: string })?.note === 'string'
          ? (input.payload as { note: string }).note.trim()
          : '';
      if (note) {
        const preview =
          note.length > 280 ? `${note.slice(0, 277)}…` : note;
        extra = `<p><strong>Alasan sanggahan:</strong><br/>${escapeHtml(preview)}</p>`;
      }
    }

    const subject = `[WorkRecord] Admin mengajukan ${label.noun} — perlu persetujuan Anda`;
    const bodyCore = `
      <p>Admin <strong>${escapeHtml(adminName)}</strong> (ID login: ${escapeHtml(adminLogin)}) di <strong>${escapeHtml(companyName)}</strong> ${label.verb}.</p>
      <p>Karyawan: <strong>${escapeHtml(employeeName)}</strong></p>
      ${extra}
      <p>Sebagai <strong>Pimpinan</strong>, silakan masuk ke portal WorkRecord untuk <strong>menyetujui atau menolak</strong> pengajuan ini.</p>
      <p><a href="${portalUrl}">Buka daftar karyawan &amp; persetujuan</a></p>
      <p style="color:#64748b;font-size:12px;">ID pengajuan: ${input.requestId}</p>
    `;
    const text = `Admin ${adminName} mengajukan ${label.noun} untuk ${employeeName}. Buka ${portalUrl} untuk menyetujui atau menolak.`;

    for (const leader of leaders) {
      const to = leader.email?.trim();
      if (!to) continue;
      const name = leader.fullName?.trim();
      const html = `<p>Halo${name ? ` ${escapeHtml(name)}` : ''},</p>${bodyCore}`;
      await this.safeSend(
        () =>
          this.mail.sendMail({
            to,
            subject,
            html,
            text,
          }),
        `leader-${input.requestId}-${to}`,
      );
    }
  }
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
