import { Injectable } from '@nestjs/common';
import { and, eq, gte, lte } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import { companies, subscriptions } from '../database/schema';

@Injectable()
export class SubscriptionsService {
  constructor(private readonly database: DatabaseService) {}

  private get db() {
    return this.database.db;
  }

  async createPending(userId: string, companyId: string, paymentId: string) {
    const [row] = await this.db
      .insert(subscriptions)
      .values({
        userId,
        companyId,
        paymentId,
        status: 'PENDING_PAYMENT',
      })
      .returning();
    return row;
  }

  async onPaymentSuccess(paymentId: string) {
    const sub = await this.db.query.subscriptions.findFirst({
      where: eq(subscriptions.paymentId, paymentId),
    });
    if (!sub) return;

    await this.db
      .update(subscriptions)
      .set({ status: 'PENDING_SURVEY', updatedAt: new Date() })
      .where(eq(subscriptions.id, sub.id));

    await this.db
      .update(companies)
      .set({ surveyStatus: 'IN_PROGRESS', updatedAt: new Date() })
      .where(eq(companies.id, sub.companyId));
  }

  async activateAfterSurvey(subscriptionId: string, months = 1) {
    const now = new Date();
    const ends = new Date(now);
    ends.setMonth(ends.getMonth() + months);

    const [row] = await this.db
      .update(subscriptions)
      .set({
        status: 'ACTIVE',
        startsAt: now,
        endsAt: ends,
        updatedAt: new Date(),
      })
      .where(eq(subscriptions.id, subscriptionId))
      .returning();
    return row;
  }

  async getActiveSubscription(userId: string, companyId: string) {
    const now = new Date();
    return this.db.query.subscriptions.findFirst({
      where: and(
        eq(subscriptions.userId, userId),
        eq(subscriptions.companyId, companyId),
        eq(subscriptions.status, 'ACTIVE'),
        lte(subscriptions.startsAt, now),
        gte(subscriptions.endsAt, now),
      ),
    });
  }

  async hasActiveCrudSubscription(userId: string, companyId: string) {
    const sub = await this.getActiveSubscription(userId, companyId);
    return !!sub;
  }

  async companyHasActiveSubscription(companyId: string) {
    const now = new Date();
    const sub = await this.db.query.subscriptions.findFirst({
      where: and(
        eq(subscriptions.companyId, companyId),
        eq(subscriptions.status, 'ACTIVE'),
        lte(subscriptions.startsAt, now),
        gte(subscriptions.endsAt, now),
      ),
    });
    return !!sub;
  }
}
