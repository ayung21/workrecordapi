import { Injectable } from '@nestjs/common';
import { DisputeStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDisputeDto } from './dto/create-dispute.dto';
import { MailService } from '../mail/mail.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class DisputesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
  ) {}

  async create(dto: CreateDisputeDto, reporterUserId?: string) {
    const dispute = await this.prisma.dispute.create({
      data: {
        companyId: dto.companyId,
        employeeRecordId: dto.employeeRecordId,
        reporterEmail: dto.reporterEmail,
        reporterUserId,
        description: dto.description,
        status: DisputeStatus.OPEN,
      },
    });

    await this.audit.log({
      action: 'DISPUTE_CREATED',
      actorUserId: reporterUserId,
      companyId: dto.companyId,
      entityType: 'Dispute',
      entityId: dispute.id,
    });

    await this.mail.sendMail({
      to: dto.reporterEmail,
      subject: 'Pengaduan WorkRecord diterima',
      html: `<p>Pengaduan Anda telah diterima. WorkRecord bersifat netral dan akan menghubungi PT terkait untuk verifikasi.</p><p>ID pengaduan: ${dispute.id}</p>`,
    });

    return dispute;
  }

  async listOpen() {
    return this.prisma.dispute.findMany({
      where: { status: { in: ['OPEN', 'INVESTIGATING'] } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateStatus(
    id: string,
    status: DisputeStatus,
    resolutionNotes?: string,
    actorUserId?: string,
  ) {
    const dispute = await this.prisma.dispute.update({
      where: { id },
      data: { status, resolutionNotes },
    });
    await this.audit.log({
      action: 'DISPUTE_STATUS_UPDATE',
      actorUserId,
      companyId: dispute.companyId,
      entityType: 'Dispute',
      entityId: id,
      metadata: { status, resolutionNotes },
    });
    return dispute;
  }
}
