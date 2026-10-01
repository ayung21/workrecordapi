import { Injectable } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type AuditLogInput = {
  action: AuditAction;
  actorUserId?: string;
  companyId?: string;
  entityType?: string;
  entityId?: string;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Prisma.InputJsonValue;
};

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(input: AuditLogInput): Promise<void> {
    await this.prisma.auditLog.create({ data: input });
  }

  async list(filters: {
    companyId?: string;
    actorUserId?: string;
    action?: AuditAction;
    from?: Date;
    to?: Date;
    limit?: number;
  }) {
    const limit = Math.min(filters.limit ?? 50, 200);
    return this.prisma.auditLog.findMany({
      where: {
        companyId: filters.companyId,
        actorUserId: filters.actorUserId,
        action: filters.action,
        createdAt: {
          gte: filters.from,
          lte: filters.to,
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
}
