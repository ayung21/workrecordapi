import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { UserAccountType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { generatePublicLoginId, generateSecureToken } from '../common/utils/id-generator';
import { MailService } from '../mail/mail.service';
import { RegisterCompanyDto } from './dto/register-company.dto';
import { PaymentsService } from '../payments/payments.service';
import { AuthService } from '../auth/auth.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { InviteLeadershipDto } from './dto/invite-leadership.dto';
import { JwtPayload } from '../auth/types/jwt-payload';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class CompaniesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly payments: PaymentsService,
    private readonly auth: AuthService,
    private readonly subscriptions: SubscriptionsService,
    private readonly audit: AuditService,
  ) {}

  async register(dto: RegisterCompanyDto) {
    const email = dto.email.toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException('Email sudah terdaftar');

    const adminRole = await this.prisma.role.findUnique({
      where: { code: 'COMPANY_ADMIN' },
    });
    if (!adminRole) {
      throw new Error('Roles not seeded. Run: npm run prisma:seed');
    }

    const adminPublicId = await this.uniquePublicId('ADM');

    const passwordHash = await bcrypt.hash(dto.password, 12);

    const result = await this.prisma.$transaction(async (tx) => {
      const company = await tx.company.create({
        data: {
          name: dto.companyName,
          companyPhone: dto.companyPhone,
          adminPublicId,
        },
      });

      const adminUser = await tx.user.create({
        data: {
          publicLoginId: adminPublicId,
          email,
          passwordHash,
          fullName: dto.fullName,
          personalPhone: dto.personalPhone,
          accountType: UserAccountType.ADMIN,
          roleId: adminRole.id,
          companyId: company.id,
        },
      });

      return { company, adminUser };
    });

    await this.mail.sendMail({
      to: email,
      subject: 'ID Login WorkRecord — Admin',
      html: `
        <p>Terima kasih mendaftar di WorkRecord (platform netral verifikasi riwayat kerja).</p>
        <p><strong>ID Admin:</strong> ${adminPublicId}</p>
        <p>Login dapat menggunakan ID atau email (setelah verifikasi email).</p>
        <p>Selesaikan pembayaran langganan. Setelah langganan aktif, Anda dapat mengundang akun <strong>Pimpinan</strong> dari dashboard.</p>
      `,
    });

    const checkout = await this.payments.createSubscriptionPayment(
      result.adminUser.id,
      result.company.id,
    );

    await this.auth.requestEmailVerification(result.adminUser.id);

    await this.audit.log({
      action: 'COMPANY_REGISTER',
      actorUserId: result.adminUser.id,
      companyId: result.company.id,
      entityType: 'Company',
      entityId: result.company.id,
      metadata: { adminPublicId },
    });

    return {
      companyId: result.company.id,
      adminPublicId,
      checkout,
      message:
        'Registrasi berhasil. ID Admin dikirim ke email. Setelah langganan aktif, undang Pimpinan via API/dashboard.',
    };
  }

  async inviteLeadership(
    companyId: string,
    actor: JwtPayload,
    dto: InviteLeadershipDto,
  ) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
    });
    if (!company) throw new NotFoundException('PT tidak ditemukan');

    if (actor.roleCode !== 'OWNER') {
      if (actor.companyId !== companyId || actor.roleCode !== 'COMPANY_ADMIN') {
        throw new ForbiddenException('Hanya Admin PT yang dapat mengundang Pimpinan');
      }
    }

    const subscribed = await this.subscriptions.companyHasActiveSubscription(
      companyId,
    );
    if (!subscribed) {
      throw new ForbiddenException(
        'Undang Pimpinan hanya setelah langganan PT aktif (bayar + survey diverifikasi)',
      );
    }

    if (company.leaderPublicId) {
      const existingLeader = await this.prisma.user.findFirst({
        where: { companyId, accountType: UserAccountType.LEADERSHIP },
      });
      if (existingLeader) {
        throw new ConflictException('Akun Pimpinan untuk PT ini sudah ada');
      }
    }

    const leaderEmail = dto.email.toLowerCase();
    const emailTaken = await this.prisma.user.findUnique({
      where: { email: leaderEmail },
    });
    if (emailTaken) throw new ConflictException('Email sudah digunakan');

    const leaderRole = await this.prisma.role.findUnique({
      where: { code: 'COMPANY_LEADERSHIP' },
    });
    if (!leaderRole) throw new Error('Role pimpinan belum di-seed');

    const leaderPublicId = await this.uniquePublicId('LDR');
    const tempSecret = generateSecureToken();
    const passwordHash = await bcrypt.hash(tempSecret, 12);

    const leader = await this.prisma.$transaction(async (tx) => {
      await tx.company.update({
        where: { id: companyId },
        data: {
          leaderPublicId,
          leadershipInvitedAt: new Date(),
        },
      });

      return tx.user.create({
        data: {
          publicLoginId: leaderPublicId,
          email: leaderEmail,
          passwordHash,
          fullName: dto.fullName,
          personalPhone: dto.personalPhone,
          accountType: UserAccountType.LEADERSHIP,
          roleId: leaderRole.id,
          companyId,
        },
      });
    });

    await this.mail.sendMail({
      to: leaderEmail,
      subject: 'Undangan Pimpinan WorkRecord',
      html: `
        <p>Anda diundang sebagai <strong>Pimpinan</strong> di ${company.name} pada WorkRecord.</p>
        <p><strong>ID Login:</strong> ${leaderPublicId}</p>
        <p>Silakan atur password melalui link yang dikirim terpisah, lalu verifikasi email.</p>
      `,
    });

    await this.auth.requestPasswordReset(leaderEmail);
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
      const exists = await this.prisma.company.findFirst({
        where: {
          OR: [{ adminPublicId: id }, { leaderPublicId: id }],
        },
      });
      const userExists = await this.prisma.user.findUnique({
        where: { publicLoginId: id },
      });
      if (!exists && !userExists) return id;
    }
    throw new ConflictException('Gagal generate ID unik');
  }

  async findOne(id: string) {
    const company = await this.prisma.company.findUnique({ where: { id } });
    if (!company) throw new NotFoundException();
    return company;
  }

  async listForOwner() {
    return this.prisma.company.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async updateSurvey(
    companyId: string,
    status: 'VERIFIED' | 'REJECTED',
    notes?: string,
    actorUserId?: string,
  ) {
    const company = await this.prisma.company.update({
      where: { id: companyId },
      data: {
        surveyStatus: status,
        surveyNotes: notes,
        verifiedAt: status === 'VERIFIED' ? new Date() : null,
      },
    });

    await this.audit.log({
      action: 'COMPANY_SURVEY_UPDATE',
      actorUserId,
      companyId,
      entityType: 'Company',
      entityId: companyId,
      metadata: { status, notes },
    });

    if (status === 'VERIFIED') {
      const pendingSub = await this.prisma.subscription.findFirst({
        where: {
          companyId,
          status: 'PENDING_SURVEY',
        },
        orderBy: { createdAt: 'desc' },
      });
      if (pendingSub) {
        const meta = pendingSub.paymentId
          ? (
              await this.prisma.payment.findUnique({
                where: { id: pendingSub.paymentId },
              })
            )?.metadata
          : null;
        const months =
          meta && typeof meta === 'object' && meta !== null && 'months' in meta
            ? Number((meta as { months: number }).months)
            : 1;
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

        const admin = await this.prisma.user.findFirst({
          where: { companyId, accountType: UserAccountType.ADMIN },
        });
        if (admin) {
          await this.mail.sendMail({
            to: admin.email,
            subject: 'Langganan aktif — undang Pimpinan',
            html: `<p>Langganan WorkRecord untuk ${company.name} sudah aktif.</p><p>Silakan undang akun Pimpinan melalui menu perusahaan agar approval record dapat berjalan.</p>`,
          });
        }
      }
    }

    return company;
  }
}
