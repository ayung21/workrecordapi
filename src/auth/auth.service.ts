import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { randomInt, timingSafeEqual } from 'crypto';
import { and, eq, or } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import {
  accountActivationTokens,
  emailVerificationTokens,
  users,
} from '../database/schema';
import { JwtPayload } from './types/jwt-payload';
import { MailService } from '../mail/mail.service';
import { ConfigService } from '@nestjs/config';
import { generateSecureToken } from '../common/utils/id-generator';
import { hashToken } from '../common/utils/hash';
import { RedisService } from '../redis/redis.service';
import { AuditService } from '../audit/audit.service';
import { isPlatformOwner } from './constants/platform-roles';
import { AuditAction } from '../database/enums';

@Injectable()
export class AuthService {
  constructor(
    private readonly database: DatabaseService,
    private readonly jwt: JwtService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly redis: RedisService,
  ) {}

  private static readonly PWD_RESET_OTP_TTL_SEC = 600;
  private static readonly PWD_RESET_COOLDOWN_SEC = 60;
  private static readonly PWD_RESET_MAX_ATTEMPTS = 5;

  private pwdResetOtpKey(userId: string) {
    return `pwd-reset:otp:${userId}`;
  }

  private pwdResetCooldownKey(userId: string) {
    return `pwd-reset:cooldown:${userId}`;
  }

  private async findUserByLogin(login: string) {
    const normalized = login.toLowerCase();
    return this.db.query.users.findFirst({
      where: and(
        eq(users.isActive, true),
        or(eq(users.publicLoginId, login), eq(users.email, normalized)),
      ),
    });
  }

  private generateOtp(): string {
    return String(randomInt(100_000, 1_000_000));
  }

  private otpMatches(storedHash: string, otp: string): boolean {
    const a = Buffer.from(storedHash, 'hex');
    const b = Buffer.from(hashToken(otp), 'hex');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  private get db() {
    return this.database.db;
  }

  async validateUser(login: string, password: string) {
    const normalized = login.toLowerCase();
    const user = await this.db.query.users.findFirst({
      where: and(
        eq(users.isActive, true),
        or(eq(users.publicLoginId, login), eq(users.email, normalized)),
      ),
      with: {
        role: {
          with: {
            rolePermissions: { with: { permission: true } },
          },
        },
      },
    });

    if (!user) throw new UnauthorizedException('Kredensial tidak valid');

    if (login.includes('@') && !user.emailVerifiedAt) {
      throw new UnauthorizedException('Email belum diverifikasi');
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Kredensial tidak valid');

    return user;
  }

  buildPayload(user: {
    id: string;
    publicLoginId: string;
    email: string;
    companyId: string | null;
    role: {
      code: string;
      rolePermissions: { permission: { code: string } }[];
    };
  }): JwtPayload {
    return {
      sub: user.id,
      publicLoginId: user.publicLoginId,
      email: user.email,
      roleCode: user.role.code,
      companyId: user.companyId,
      permissions: user.role.rolePermissions.map((p) => p.permission.code),
    };
  }

  private async issueLoginResponse(
    user: Awaited<ReturnType<AuthService['validateUser']>>,
    meta: { ipAddress?: string; userAgent?: string } | undefined,
    auditAction: AuditAction,
    auditExtra?: Record<string, unknown>,
  ) {
    const payload = this.buildPayload(user);
    await this.audit.log({
      action: auditAction,
      actorUserId: user.id,
      companyId: user.companyId ?? undefined,
      metadata: {
        publicLoginId: user.publicLoginId,
        roleCode: user.role.code,
        ...auditExtra,
      },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });
    return {
      accessToken: await this.jwt.signAsync(payload),
      user: {
        id: user.id,
        publicLoginId: user.publicLoginId,
        email: user.email,
        accountType: user.accountType,
        companyId: user.companyId,
        roleCode: user.role.code,
      },
    };
  }

  /** Frontend utama WorkRecord — Owner dan akun perusahaan. */
  async login(
    login: string,
    password: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ) {
    const user = await this.validateUser(login, password);
    return this.issueLoginResponse(user, meta, 'AUTH_LOGIN');
  }

  /** Panel admin — hanya role platform OWNER. */
  async loginPlatformAdmin(
    login: string,
    password: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ) {
    const user = await this.validateUser(login, password);
    if (!isPlatformOwner(user.role.code)) {
      await this.audit.log({
        action: 'AUTH_ADMIN_LOGIN_DENIED',
        actorUserId: user.id,
        companyId: user.companyId ?? undefined,
        metadata: {
          publicLoginId: user.publicLoginId,
          roleCode: user.role.code,
        },
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      throw new ForbiddenException(
        'Akun perusahaan tidak dapat masuk ke panel admin. Gunakan WorkRecord.',
      );
    }
    return this.issueLoginResponse(user, meta, 'AUTH_ADMIN_LOGIN', {
      portal: 'admin',
    });
  }

  async getProfile(userId: string) {
    const user = await this.db.query.users.findFirst({
      where: eq(users.id, userId),
      with: {
        role: {
          with: {
            rolePermissions: { with: { permission: true } },
          },
        },
      },
    });
    if (!user || !user.isActive) throw new UnauthorizedException();
    const permissions = user.role.rolePermissions.map(
      (p) => p.permission.code,
    );
    return {
      user: {
        id: user.id,
        publicLoginId: user.publicLoginId,
        email: user.email,
        accountType: user.accountType,
        companyId: user.companyId,
        roleCode: user.role.code,
        permissions,
      },
    };
  }

  async changePassword(userId: string, current: string, next: string) {
    const user = await this.db.query.users.findFirst({
      where: eq(users.id, userId),
    });
    if (!user) throw new NotFoundException();
    const ok = await bcrypt.compare(current, user.passwordHash);
    if (!ok) throw new BadRequestException('Password saat ini salah');
    await this.db
      .update(users)
      .set({ passwordHash: await bcrypt.hash(next, 12), updatedAt: new Date() })
      .where(eq(users.id, userId));
    await this.audit.log({
      action: 'AUTH_PASSWORD_CHANGE',
      actorUserId: userId,
      companyId: user.companyId ?? undefined,
    });
  }

  /** Kirim OTP reset password ke email akun (OTP hanya di Redis). */
  async requestPasswordResetOtp(login: string) {
    const user = await this.findUserByLogin(login.trim());
    if (!user) return { sent: true };

    const onCooldown = await this.redis.exists(
      this.pwdResetCooldownKey(user.id),
    );
    if (onCooldown) {
      throw new BadRequestException(
        'OTP baru dapat diminta setelah 1 menit. Periksa email atau folder spam.',
      );
    }

    const otp = this.generateOtp();
    await this.redis.setJson(
      this.pwdResetOtpKey(user.id),
      { otpHash: hashToken(otp), attempts: 0 },
      AuthService.PWD_RESET_OTP_TTL_SEC,
    );
    await this.redis.setJson(
      this.pwdResetCooldownKey(user.id),
      { ok: true },
      AuthService.PWD_RESET_COOLDOWN_SEC,
    );

    await this.mail.sendMail({
      to: user.email,
      subject: 'Kode OTP reset password WorkRecord',
      html: `
        <p>Anda meminta reset password untuk akun WorkRecord.</p>
        <p><strong>Kode OTP (berlaku 10 menit):</strong> ${otp}</p>
        <p>Masukkan kode ini di halaman login aplikasi. Jangan bagikan kode kepada siapa pun.</p>
        <p>Jika Anda tidak meminta reset, abaikan email ini.</p>
      `,
      text: `Kode OTP reset password WorkRecord: ${otp} (berlaku 10 menit).`,
    });

    return { sent: true };
  }

  async resetPasswordWithOtp(
    login: string,
    otp: string,
    newPassword: string,
  ) {
    const user = await this.findUserByLogin(login.trim());
    if (!user) {
      throw new BadRequestException('OTP tidak valid atau kedaluwarsa');
    }

    const key = this.pwdResetOtpKey(user.id);
    const stored = await this.redis.getJson<{
      otpHash: string;
      attempts: number;
    }>(key);
    if (!stored) {
      throw new BadRequestException('OTP tidak valid atau kedaluwarsa');
    }

    if (stored.attempts >= AuthService.PWD_RESET_MAX_ATTEMPTS) {
      await this.redis.del(key);
      throw new BadRequestException(
        'Terlalu banyak percobaan. Minta OTP baru.',
      );
    }

    if (!this.otpMatches(stored.otpHash, otp)) {
      const attempts = stored.attempts + 1;
      const ttl = AuthService.PWD_RESET_OTP_TTL_SEC;
      if (attempts >= AuthService.PWD_RESET_MAX_ATTEMPTS) {
        await this.redis.del(key);
      } else {
        await this.redis.setJson(key, { ...stored, attempts }, ttl);
      }
      throw new BadRequestException('OTP salah');
    }

    await this.db
      .update(users)
      .set({
        passwordHash: await bcrypt.hash(newPassword, 12),
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));

    await this.redis.del(key);
    await this.audit.log({
      action: 'AUTH_PASSWORD_CHANGE',
      actorUserId: user.id,
      companyId: user.companyId ?? undefined,
      metadata: { via: 'forgot_password_otp' },
    });

    return { ok: true };
  }

  async requestEmailVerification(userId: string, newEmail?: string) {
    const user = await this.db.query.users.findFirst({
      where: eq(users.id, userId),
    });
    if (!user) throw new NotFoundException();
    if (newEmail?.trim()) {
      await this.sendEmailChangeVerification(userId, newEmail, {
        roleLabel: 'akun WorkRecord',
      });
      return;
    }
    const target = user.email.toLowerCase();
    const raw = generateSecureToken();
    await this.db.insert(emailVerificationTokens).values({
      userId,
      tokenHash: hashToken(raw),
      expiresAt: new Date(Date.now() + 86400_000),
    });
    const apiUrl = this.config.get('API_URL', 'http://localhost:3007').replace(/\/$/, '');
    const appUrl = this.config.get('APP_URL', 'http://localhost:3008').replace(/\/$/, '');
    const verifyUrl = `${apiUrl}/auth/verify-email?token=${encodeURIComponent(raw)}`;
    const greeting = user.fullName?.trim() ? `Halo ${user.fullName},` : 'Halo,';
    const html = this.buildEmailVerificationMessageHtml({
      greeting,
      roleLabel: 'akun WorkRecord',
      newEmail: target,
      verifyUrl,
      appUrl,
      companyBlock: '',
      initiatorBlock: '',
    });
    await this.mail.sendMail({
      to: target,
      subject: 'Verifikasi email akun WorkRecord',
      html,
      text: `Verifikasi email WorkRecord (24 jam): ${verifyUrl}`,
    });
  }

  async sendEmailChangeVerification(
    userId: string,
    newEmail: string,
    context?: {
      companyName?: string;
      initiatedBy?: string;
      roleLabel?: string;
    },
  ) {
    const user = await this.db.query.users.findFirst({
      where: eq(users.id, userId),
    });
    if (!user) throw new NotFoundException();

    const normalized = newEmail.trim().toLowerCase();
    if (!normalized.includes('@')) {
      throw new BadRequestException('Email tidak valid');
    }

    const raw = generateSecureToken();
    await this.db.insert(emailVerificationTokens).values({
      userId,
      tokenHash: hashToken(raw),
      newEmail: normalized,
      expiresAt: new Date(Date.now() + 86400_000),
    });

    const apiUrl = this.config.get('API_URL', 'http://localhost:3007').replace(/\/$/, '');
    const appUrl = this.config.get('APP_URL', 'http://localhost:3008').replace(/\/$/, '');
    const verifyUrl = `${apiUrl}/auth/verify-email?token=${encodeURIComponent(raw)}`;
    const greeting = user.fullName?.trim() ? `Halo ${user.fullName},` : 'Halo,';
    const roleLabel = context?.roleLabel ?? 'akun WorkRecord';
    const companyBlock = context?.companyName
      ? `<tr><td style="padding:0 0 16px;font-size:14px;line-height:1.6;color:#475569;">
            Perusahaan: <strong style="color:#0f172a;">${context.companyName}</strong>
          </td></tr>`
      : '';
    const initiatorBlock = context?.initiatedBy
      ? `<tr><td style="padding:0 0 16px;font-size:14px;line-height:1.6;color:#475569;">
            Permintaan ini diajukan oleh <strong style="color:#0f172a;">${context.initiatedBy}</strong> (Pimpinan/Master).
          </td></tr>`
      : '';

    const html = this.buildEmailVerificationMessageHtml({
      greeting,
      roleLabel,
      newEmail: normalized,
      verifyUrl,
      appUrl,
      companyBlock,
      initiatorBlock,
    });

    await this.mail.sendMail({
      to: normalized,
      subject: 'Verifikasi email Admin WorkRecord',
      html,
      text: `Verifikasi email ${roleLabel} WorkRecord (24 jam): ${verifyUrl}`,
    });
  }

  private buildEmailVerificationMessageHtml(opts: {
    greeting: string;
    roleLabel: string;
    newEmail: string;
    verifyUrl: string;
    appUrl: string;
    companyBlock: string;
    initiatorBlock: string;
  }): string {
    return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Verifikasi email — WorkRecord</title>
</head>
<body style="margin:0;padding:0;background:#eef2f8;font-family:Segoe UI,system-ui,-apple-system,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eef2f8;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 12px 40px rgba(15,23,42,.08);">
          <tr>
            <td style="padding:28px 28px 20px;background:linear-gradient(135deg,#1e3a8a 0%,#2459df 100%);">
              <p style="margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#bfdbfe;">WorkRecord</p>
              <h1 style="margin:0;font-size:22px;font-weight:700;color:#ffffff;line-height:1.3;">Verifikasi alamat email</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:28px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr><td style="padding:0 0 12px;font-size:16px;font-weight:600;color:#0f172a;">${opts.greeting}</td></tr>
                ${opts.companyBlock}
                ${opts.initiatorBlock}
                <tr><td style="padding:0 0 16px;font-size:14px;line-height:1.65;color:#475569;">
                  Konfirmasi bahwa <strong style="color:#0f172a;">${opts.newEmail}</strong> akan menjadi email login untuk <strong>${opts.roleLabel}</strong>.
                  Setelah verifikasi, Admin dapat masuk dengan email baru dan kata sandi yang sama.
                </td></tr>
                <tr><td align="center" style="padding:8px 0 20px;">
                  <a href="${opts.verifyUrl}" style="display:inline-block;padding:14px 28px;background:#2459df;color:#ffffff;text-decoration:none;border-radius:10px;font-weight:700;font-size:15px;">Verifikasi email saya</a>
                </td></tr>
                <tr><td style="padding:0 0 12px;font-size:12px;line-height:1.6;color:#64748b;">
                  Tautan berlaku <strong>24 jam</strong>. Jika tombol tidak berfungsi, salin URL berikut ke browser:
                </td></tr>
                <tr><td style="padding:0 0 16px;font-size:11px;line-height:1.5;color:#2459df;word-break:break-all;">
                  <a href="${opts.verifyUrl}" style="color:#2459df;">${opts.verifyUrl}</a>
                </td></tr>
                <tr><td style="padding:16px 0 0;border-top:1px solid #e2e8f0;font-size:12px;line-height:1.6;color:#94a3b8;">
                  Jika Anda tidak mengharapkan email ini, abaikan pesan ini. Portal: <a href="${opts.appUrl}" style="color:#2459df;">${opts.appUrl}</a>
                </td></tr>
              </table>
            </td>
          </tr>
        </table>
        <p style="margin:16px 0 0;font-size:11px;color:#94a3b8;">© WorkRecord — verifikasi riwayat kerja tenaga kerja</p>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }

  async verifyEmail(token: string) {
    const row = await this.db.query.emailVerificationTokens.findFirst({
      where: eq(emailVerificationTokens.tokenHash, hashToken(token)),
    });
    if (!row || row.usedAt || row.expiresAt < new Date()) {
      throw new BadRequestException('Token tidak valid');
    }
    const patch: { emailVerifiedAt: Date; email?: string; updatedAt: Date } = {
      emailVerifiedAt: new Date(),
      updatedAt: new Date(),
    };
    if (row.newEmail) patch.email = row.newEmail;

    await this.db.transaction(async (tx) => {
      await tx.update(users).set(patch).where(eq(users.id, row.userId));
      await tx
        .update(emailVerificationTokens)
        .set({ usedAt: new Date() })
        .where(eq(emailVerificationTokens.id, row.id));
    });

    return { ok: true, message: 'Email berhasil diverifikasi' };
  }

  /** Halaman HTML untuk tautan verifikasi dari email (GET). */
  async renderEmailVerificationPage(token: string): Promise<string> {
    const appUrl = this.config.get('APP_URL', 'http://localhost:3008');
    const loginUrl = appUrl.replace(/\/$/, '');

    if (!token?.trim()) {
      return this.verificationResultHtml({
        ok: false,
        title: 'Tautan tidak lengkap',
        body: 'Token verifikasi tidak ditemukan. Buka kembali email WorkRecord dan klik tombol verifikasi, atau minta kirim ulang dari menu akun.',
        loginUrl,
      });
    }

    try {
      await this.verifyEmail(token.trim());
      return this.verificationResultHtml({
        ok: true,
        title: 'Email berhasil diverifikasi',
        body:
          'Alamat email Anda sudah aktif. Anda dapat masuk ke WorkRecord dengan email atau ID login beserta kata sandi yang telah Anda buat.',
        loginUrl,
      });
    } catch {
      return this.verificationResultHtml({
        ok: false,
        title: 'Verifikasi gagal',
        body:
          'Tautan tidak valid, sudah dipakai, atau kedaluwarsa (berlaku 24 jam). Minta email verifikasi baru setelah masuk ke akun, atau hubungi admin perusahaan Anda.',
        loginUrl,
      });
    }
  }

  private verificationResultHtml(opts: {
    ok: boolean;
    title: string;
    body: string;
    loginUrl: string;
  }): string {
    const accent = opts.ok ? '#0f766e' : '#b45309';
    return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${opts.title} — WorkRecord</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #f8fafc; margin: 0; padding: 2rem; color: #0f172a; }
    .card { max-width: 28rem; margin: 0 auto; background: #fff; border-radius: 12px; padding: 2rem; box-shadow: 0 4px 24px rgba(15,23,42,.08); }
    h1 { font-size: 1.35rem; margin: 0 0 1rem; color: ${accent}; }
    p { line-height: 1.6; margin: 0 0 1rem; }
    a.btn { display: inline-block; margin-top: .5rem; padding: 12px 20px; background: #0f766e; color: #fff !important; text-decoration: none; border-radius: 8px; font-weight: 600; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${opts.title}</h1>
    <p>${opts.body}</p>
    <p><a class="btn" href="${opts.loginUrl}">Buka WorkRecord</a></p>
  </div>
</body>
</html>`;
  }

  async sendAccountActivation(
    userId: string,
    meta?: { publicLoginId: string; roleLabel: string; companyName?: string },
  ) {
    const user = await this.db.query.users.findFirst({
      where: eq(users.id, userId),
    });
    if (!user) throw new NotFoundException();

    const raw = generateSecureToken();
    await this.db.insert(accountActivationTokens).values({
      userId,
      tokenHash: hashToken(raw),
      expiresAt: new Date(Date.now() + 7 * 86400_000),
    });

    const appUrl = this.config.get('APP_URL', 'http://localhost:3008');
    const activateUrl = `${appUrl}/aktivasi-akun?token=${raw}`;
    const roleLabel = meta?.roleLabel ?? 'WorkRecord';
    const loginId = meta?.publicLoginId ?? user.publicLoginId;
    const companyLine = meta?.companyName
      ? `<p>Perusahaan: <strong>${meta.companyName}</strong></p>`
      : '';

    await this.mail.sendMail({
      to: user.email,
      subject: 'Atur kata sandi akun WorkRecord Anda',
      html: `
        <p>Halo ${user.fullName},</p>
        <p>Anda didaftarkan sebagai <strong>${roleLabel}</strong> di WorkRecord.</p>
        ${companyLine}
        <p><strong>ID login:</strong> ${loginId}</p>
        <p><strong>Email:</strong> ${user.email}</p>
        <p>Klik tautan berikut untuk <strong>mengatur kata sandi</strong> dan mengaktifkan akun (berlaku 7 hari):</p>
        <p><a href="${activateUrl}">${activateUrl}</a></p>
        <p>Setelah selesai, masuk ke WorkRecord dengan ID login atau email dan kata sandi yang Anda buat.</p>
      `,
      text: `Atur kata sandi akun WorkRecord: ${activateUrl} (ID login: ${loginId})`,
    });
  }

  async getActivationPreview(token: string) {
    const row = await this.db.query.accountActivationTokens.findFirst({
      where: eq(accountActivationTokens.tokenHash, hashToken(token)),
    });
    if (!row || row.usedAt || row.expiresAt < new Date()) {
      throw new BadRequestException('Token aktivasi tidak valid atau kedaluwarsa');
    }
    const user = await this.db.query.users.findFirst({
      where: eq(users.id, row.userId),
    });
    if (!user) throw new NotFoundException();
    return {
      email: user.email,
      publicLoginId: user.publicLoginId,
      emailVerified: Boolean(user.emailVerifiedAt),
    };
  }

  async activateAccount(token: string, newPassword: string) {
    const row = await this.db.query.accountActivationTokens.findFirst({
      where: eq(accountActivationTokens.tokenHash, hashToken(token)),
    });
    if (!row || row.usedAt || row.expiresAt < new Date()) {
      throw new BadRequestException('Token aktivasi tidak valid atau kedaluwarsa');
    }

    await this.db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({
          passwordHash: await bcrypt.hash(newPassword, 12),
          emailVerifiedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(users.id, row.userId));
      await tx
        .update(accountActivationTokens)
        .set({ usedAt: new Date() })
        .where(eq(accountActivationTokens.id, row.id));
    });

    await this.audit.log({
      action: 'AUTH_PASSWORD_CHANGE',
      actorUserId: row.userId,
      metadata: { via: 'account_activation' },
    });
  }
}
