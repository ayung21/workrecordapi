import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { desc, eq, inArray } from 'drizzle-orm';
import { DisputeStatus } from '../database/enums';
import { DatabaseService } from '../database/database.service';
import { disputes, payments } from '../database/schema';
import { CreateDisputeDto } from './dto/create-dispute.dto';
import { MailService } from '../mail/mail.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class DisputesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
  ) {}

  private get db() {
    return this.database.db;
  }

  async create(dto: CreateDisputeDto, reporterUserId?: string) {
    const payment = await this.db.query.payments.findFirst({
      where: eq(payments.id, dto.paymentId),
    });
    if (!payment || payment.type !== 'DISPUTE' || payment.status !== 'PAID') {
      throw new BadRequestException(
        'Pembayaran sanggahan belum selesai atau tidak valid',
      );
    }
    if (payment.companyId !== dto.companyId) {
      throw new ForbiddenException('Pembayaran tidak sesuai perusahaan');
    }

    const used = await this.db.query.disputes.findFirst({
      where: eq(disputes.paymentId, dto.paymentId),
    });
    if (used) {
      throw new BadRequestException('Pembayaran sudah digunakan');
    }

    const [dispute] = await this.db
      .insert(disputes)
      .values({
        companyId: dto.companyId,
        employeeRecordId: dto.employeeRecordId,
        reporterEmail: dto.reporterEmail,
        reporterUserId,
        description: dto.description,
        paymentId: dto.paymentId,
        status: 'OPEN',
      })
      .returning();

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
    return this.db
      .select()
      .from(disputes)
      .where(inArray(disputes.status, ['OPEN', 'INVESTIGATING']))
      .orderBy(desc(disputes.createdAt));
  }

  async updateStatus(
    id: string,
    status: DisputeStatus,
    resolutionNotes?: string,
    actorUserId?: string,
  ) {
    const [dispute] = await this.db
      .update(disputes)
      .set({ status, resolutionNotes, updatedAt: new Date() })
      .where(eq(disputes.id, id))
      .returning();
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
