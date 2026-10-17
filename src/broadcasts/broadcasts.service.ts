import { Injectable } from '@nestjs/common';
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import { broadcastCampaigns, users } from '../database/schema';
import { MailService } from '../mail/mail.service';
import { CreateBroadcastDto } from './dto/create-broadcast.dto';
@Injectable()
export class BroadcastsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly mail: MailService,
  ) {}

  private get db() {
    return this.database.db;
  }

  list() {
    return this.db
      .select()
      .from(broadcastCampaigns)
      .orderBy(desc(broadcastCampaigns.createdAt));
  }

  async send(dto: CreateBroadcastDto, createdByUserId: string) {
    const all = await this.db.query.users.findMany({
      where: and(eq(users.isActive, true), isNotNull(users.email)),
      columns: { email: true, companyId: true },
    });

    let targets = all;
    if (dto.audience === 'COMPANY_USERS') {
      targets = all.filter((u) => u.companyId);
    } else if (dto.audience === 'PLATFORM_OWNER') {
      targets = all.filter((u) => !u.companyId);
    }

    const emails = [...new Set(targets.map((t) => t.email).filter(Boolean))];
    for (const to of emails) {
      await this.mail.sendMail({
        to,
        subject: dto.subject,
        html: dto.htmlBody,
      });
    }

    const [row] = await this.db
      .insert(broadcastCampaigns)
      .values({
        subject: dto.subject,
        htmlBody: dto.htmlBody,
        audience: dto.audience,
        recipientCount: emails.length,
        sentAt: new Date(),
        createdByUserId,
      })
      .returning();

    return row;
  }
}
