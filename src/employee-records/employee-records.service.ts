import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  RecordChangeAction,
  RecordChangeStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AccessService } from '../access/access.service';
import { JwtPayload } from '../auth/types/jwt-payload';
import { CreateEmployeeRecordDto } from './dto/create-employee-record.dto';
import { UpdateEmployeeRecordDto } from './dto/update-employee-record.dto';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class EmployeeRecordsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  async list(
    companyId: string,
    user?: JwtPayload,
    viewToken?: string,
  ) {
    const records = await this.prisma.employeeRecord.findMany({
      where: { companyId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    return Promise.all(
      records.map((r) => this.maskRecord(r, user, viewToken)),
    );
  }

  async getOne(
    companyId: string,
    id: string,
    user?: JwtPayload,
    viewToken?: string,
  ) {
    const record = await this.prisma.employeeRecord.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!record) throw new NotFoundException();
    return this.maskRecord(record, user, viewToken);
  }

  private async maskRecord(
    record: {
      id: string;
      companyId: string;
      employeeName: string;
      employeeIdNumber: string | null;
      position: string | null;
      joinedAt: Date | null;
      leftAt: Date | null;
      conductSummary: string | null;
      violationNotes: string | null;
      createdAt: Date;
      updatedAt: Date;
    },
    user?: JwtPayload,
    viewToken?: string,
  ) {
    const visibility = await this.access.canViewRecord(
      record.companyId,
      record.id,
      user,
      viewToken,
    );

    if (visibility === 'denied') {
      throw new NotFoundException();
    }

    if (visibility === 'blurred') {
      return {
        id: record.id,
        employeeName: this.blurText(record.employeeName),
        position: record.position ? '***' : null,
        joinedAt: null,
        leftAt: null,
        conductSummary: '*** (bayar untuk melihat detail)',
        violationNotes: null,
        visibility: 'blurred',
      };
    }

    return { ...record, visibility: 'full' };
  }

  private blurText(value: string): string {
    if (value.length <= 2) return '*';
    return value[0] + '*'.repeat(value.length - 2) + value[value.length - 1];
  }

  async create(
    companyId: string,
    user: JwtPayload,
    dto: CreateEmployeeRecordDto,
  ) {
    const gate = await this.access.canCrudRecords(user, companyId);
    if (!gate.allowed) {
      throw new ForbiddenException(gate.reason ?? 'Tidak diizinkan');
    }

    const payload = { ...dto };

    if (gate.needsApproval) {
      const req = await this.prisma.recordChangeRequest.create({
        data: {
          companyId,
          action: RecordChangeAction.CREATE,
          status: RecordChangeStatus.PENDING_APPROVAL,
          payload,
          requestedById: user.sub,
        },
      });
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

    const created = await this.prisma.employeeRecord.create({
      data: {
        companyId,
        ...dto,
        joinedAt: dto.joinedAt ? new Date(dto.joinedAt) : null,
        leftAt: dto.leftAt ? new Date(dto.leftAt) : null,
      },
    });
    await this.audit.log({
      action: 'RECORD_CREATE',
      actorUserId: user.sub,
      companyId,
      entityType: 'EmployeeRecord',
      entityId: created.id,
    });
    return created;
  }

  async update(
    companyId: string,
    id: string,
    user: JwtPayload,
    dto: UpdateEmployeeRecordDto,
  ) {
    const gate = await this.access.canCrudRecords(user, companyId);
    if (!gate.allowed) throw new ForbiddenException(gate.reason);

    const payload = { id, ...dto };

    if (gate.needsApproval) {
      const req = await this.prisma.recordChangeRequest.create({
        data: {
          companyId,
          employeeRecordId: id,
          action: RecordChangeAction.UPDATE,
          status: RecordChangeStatus.PENDING_APPROVAL,
          payload,
          requestedById: user.sub,
        },
      });
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

    const updated = await this.prisma.employeeRecord.update({
      where: { id },
      data: {
        ...dto,
        joinedAt: dto.joinedAt ? new Date(dto.joinedAt) : undefined,
        leftAt: dto.leftAt ? new Date(dto.leftAt) : undefined,
      },
    });
    await this.audit.log({
      action: 'RECORD_UPDATE',
      actorUserId: user.sub,
      companyId,
      entityType: 'EmployeeRecord',
      entityId: id,
    });
    return updated;
  }

  async softDelete(companyId: string, id: string, user: JwtPayload) {
    const gate = await this.access.canCrudRecords(user, companyId);
    if (!gate.allowed) throw new ForbiddenException(gate.reason);

    if (gate.needsApproval) {
      const req = await this.prisma.recordChangeRequest.create({
        data: {
          companyId,
          employeeRecordId: id,
          action: RecordChangeAction.DELETE,
          status: RecordChangeStatus.PENDING_APPROVAL,
          payload: { id },
          requestedById: user.sub,
        },
      });
      await this.audit.log({
        action: 'RECORD_DELETE',
        actorUserId: user.sub,
        companyId,
        entityType: 'RecordChangeRequest',
        entityId: req.id,
        metadata: { employeeRecordId: id, pendingApproval: true },
      });
      return req;
    }

    const deleted = await this.prisma.employeeRecord.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    await this.audit.log({
      action: 'RECORD_DELETE',
      actorUserId: user.sub,
      companyId,
      entityType: 'EmployeeRecord',
      entityId: id,
    });
    return deleted;
  }

  async approveChange(requestId: string, leader: JwtPayload) {
    const req = await this.prisma.recordChangeRequest.findUniqueOrThrow({
      where: { id: requestId },
    });
    if (req.status !== RecordChangeStatus.PENDING_APPROVAL) {
      throw new ForbiddenException('Request sudah diproses');
    }

    const leaderUser = await this.prisma.user.findUniqueOrThrow({
      where: { id: leader.sub },
    });
    if (
      leaderUser.accountType !== 'LEADERSHIP' &&
      leader.roleCode !== 'OWNER'
    ) {
      throw new ForbiddenException('Hanya pimpinan yang dapat approve');
    }

    let result: unknown;

    if (req.action === RecordChangeAction.CREATE) {
      const p = req.payload as unknown as CreateEmployeeRecordDto;
      result = await this.prisma.employeeRecord.create({
        data: {
          companyId: req.companyId,
          employeeName: p.employeeName,
          employeeIdNumber: p.employeeIdNumber,
          position: p.position,
          conductSummary: p.conductSummary,
          violationNotes: p.violationNotes,
          joinedAt: p.joinedAt ? new Date(p.joinedAt) : null,
          leftAt: p.leftAt ? new Date(p.leftAt) : null,
        },
      });
    } else if (req.action === RecordChangeAction.UPDATE) {
      const p = req.payload as unknown as UpdateEmployeeRecordDto & {
        id: string;
      };
      result = await this.prisma.employeeRecord.update({
        where: { id: p.id },
        data: {
          employeeName: p.employeeName,
          employeeIdNumber: p.employeeIdNumber,
          position: p.position,
          conductSummary: p.conductSummary,
          violationNotes: p.violationNotes,
          joinedAt: p.joinedAt ? new Date(p.joinedAt) : undefined,
          leftAt: p.leftAt ? new Date(p.leftAt) : undefined,
        },
      });
    } else if (req.action === RecordChangeAction.DELETE) {
      const p = req.payload as unknown as { id: string };
      result = await this.prisma.employeeRecord.update({
        where: { id: p.id },
        data: { deletedAt: new Date() },
      });
    }

    const updatedReq = await this.prisma.recordChangeRequest.update({
      where: { id: requestId },
      data: {
        status: RecordChangeStatus.APPROVED,
        approvedById: leader.sub,
        appliedAt: new Date(),
      },
    });
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
    return this.prisma.recordChangeRequest.findMany({
      where: {
        companyId,
        status: RecordChangeStatus.PENDING_APPROVAL,
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
