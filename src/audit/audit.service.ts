import { BadRequestException, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, lte } from 'drizzle-orm';
import { auditActions, AuditAction } from '../database/enums';
import { DatabaseService } from '../database/database.service';
import { auditLogs, companies, users } from '../database/schema';

export type AuditLogInput = {
  action: AuditAction;
  actorUserId?: string;
  companyId?: string;
  entityType?: string;
  entityId?: string;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
};

@Injectable()
export class AuditService {
  constructor(private readonly database: DatabaseService) {}

  private get db() {
    return this.database.db;
  }

  async log(input: AuditLogInput): Promise<void> {
    await this.db.insert(auditLogs).values(input);
  }

  private buildListConditions(filters: {
    companyId?: string;
    actorUserId?: string;
    action?: AuditAction;
    from?: Date;
    to?: Date;
  }) {
    if (filters.action && !auditActions.includes(filters.action)) {
      throw new BadRequestException('Filter aksi audit tidak valid');
    }
    const conditions = [];
    if (filters.companyId) {
      conditions.push(eq(auditLogs.companyId, filters.companyId));
    }
    if (filters.actorUserId) {
      conditions.push(eq(auditLogs.actorUserId, filters.actorUserId));
    }
    if (filters.action) {
      conditions.push(eq(auditLogs.action, filters.action));
    }
    if (filters.from) {
      conditions.push(gte(auditLogs.createdAt, filters.from));
    }
    if (filters.to) {
      conditions.push(lte(auditLogs.createdAt, filters.to));
    }
    return conditions;
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
    const conditions = this.buildListConditions(filters);

    return this.db
      .select()
      .from(auditLogs)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit);
  }

  /** Panel admin Owner — join nama PT & pelaku. */
  async listEnriched(filters: {
    companyId?: string;
    actorUserId?: string;
    action?: AuditAction;
    from?: Date;
    to?: Date;
    limit?: number;
  }) {
    const limit = Math.min(filters.limit ?? 50, 200);
    const conditions = this.buildListConditions(filters);

    const rows = await this.db
      .select({
        id: auditLogs.id,
        action: auditLogs.action,
        actorUserId: auditLogs.actorUserId,
        companyId: auditLogs.companyId,
        entityType: auditLogs.entityType,
        entityId: auditLogs.entityId,
        ipAddress: auditLogs.ipAddress,
        userAgent: auditLogs.userAgent,
        metadata: auditLogs.metadata,
        createdAt: auditLogs.createdAt,
        companyName: companies.name,
        actorPublicLoginId: users.publicLoginId,
        actorFullName: users.fullName,
        actorEmail: users.email,
      })
      .from(auditLogs)
      .leftJoin(companies, eq(auditLogs.companyId, companies.id))
      .leftJoin(users, eq(auditLogs.actorUserId, users.id))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit);

    return { items: rows, limit };
  }
}
