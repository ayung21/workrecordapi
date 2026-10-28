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
    const target = (newEmail ?? user.email).toLowerCase();
    const raw = generateSecureToken();
    await this.db.insert(emailVerificationTokens).values({
      userId,
      tokenHash: hashToken(raw),
      newEmail: newEmail?.toLowerCase(),
      expiresAt: new Date(Date.now() + 86400_000),
    });
    const apiUrl = this.config.get('API_URL', 'http://localhost:3000');
    await this.mail.sendMail({
      to: target,
      subject: 'Verifikasi email WorkRecord',
      html: `<p>Verifikasi: <a href="${apiUrl}/auth/verify-email?token=${raw}">klik di sini</a></p>`,
    });
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
