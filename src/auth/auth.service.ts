import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { JwtPayload } from './types/jwt-payload';
import { MailService } from '../mail/mail.service';
import { ConfigService } from '@nestjs/config';
import { generateSecureToken } from '../common/utils/id-generator';
import { hashToken } from '../common/utils/hash';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  async validateUser(login: string, password: string) {
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [
          { publicLoginId: login },
          { email: login.toLowerCase() },
        ],
        isActive: true,
      },
      include: {
        role: {
          include: {
            permissions: { include: { permission: true } },
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
      permissions: { permission: { code: string } }[];
    };
  }): JwtPayload {
    return {
      sub: user.id,
      publicLoginId: user.publicLoginId,
      email: user.email,
      roleCode: user.role.code,
      companyId: user.companyId,
      permissions: user.role.permissions.map((p) => p.permission.code),
    };
  }

  async login(
    login: string,
    password: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ) {
    const user = await this.validateUser(login, password);
    const payload = this.buildPayload(user);
    await this.audit.log({
      action: 'AUTH_LOGIN',
      actorUserId: user.id,
      companyId: user.companyId ?? undefined,
      metadata: { publicLoginId: user.publicLoginId },
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

  async changePassword(userId: string, current: string, next: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    const ok = await bcrypt.compare(current, user.passwordHash);
    if (!ok) throw new BadRequestException('Password saat ini salah');
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await bcrypt.hash(next, 12) },
    });
    await this.audit.log({
      action: 'AUTH_PASSWORD_CHANGE',
      actorUserId: userId,
      companyId: user.companyId ?? undefined,
    });
  }

  async requestPasswordReset(email: string) {
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });
    if (!user) return { sent: true };

    const raw = generateSecureToken();
    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(raw),
        expiresAt: new Date(Date.now() + 3600_000),
      },
    });

    const apiUrl = this.config.get('API_URL', 'http://localhost:3000');
    await this.mail.sendMail({
      to: user.email,
      subject: 'Reset password WorkRecord',
      html: `<p>Reset password: <a href="${apiUrl}/auth/reset-password?token=${raw}">klik di sini</a></p>`,
    });
    return { sent: true };
  }

  async resetPassword(token: string, newPassword: string) {
    const row = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: hashToken(token) },
    });
    if (!row || row.usedAt || row.expiresAt < new Date()) {
      throw new BadRequestException('Token tidak valid');
    }
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: row.userId },
        data: { passwordHash: await bcrypt.hash(newPassword, 12) },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: row.id },
        data: { usedAt: new Date() },
      }),
    ]);
  }

  async requestEmailVerification(userId: string, newEmail?: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    const target = (newEmail ?? user.email).toLowerCase();
    const raw = generateSecureToken();
    await this.prisma.emailVerificationToken.create({
      data: {
        userId,
        tokenHash: hashToken(raw),
        newEmail: newEmail?.toLowerCase(),
        expiresAt: new Date(Date.now() + 86400_000),
      },
    });
    const apiUrl = this.config.get('API_URL', 'http://localhost:3000');
    await this.mail.sendMail({
      to: target,
      subject: 'Verifikasi email WorkRecord',
      html: `<p>Verifikasi: <a href="${apiUrl}/auth/verify-email?token=${raw}">klik di sini</a></p>`,
    });
  }

  async verifyEmail(token: string) {
    const row = await this.prisma.emailVerificationToken.findUnique({
      where: { tokenHash: hashToken(token) },
    });
    if (!row || row.usedAt || row.expiresAt < new Date()) {
      throw new BadRequestException('Token tidak valid');
    }
    const data: { emailVerifiedAt: Date; email?: string } = {
      emailVerifiedAt: new Date(),
    };
    if (row.newEmail) data.email = row.newEmail;

    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: row.userId }, data }),
      this.prisma.emailVerificationToken.update({
        where: { id: row.id },
        data: { usedAt: new Date() },
      }),
    ]);
  }
}
