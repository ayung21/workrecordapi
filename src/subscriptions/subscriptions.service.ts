import { Injectable } from '@nestjs/common';
import { SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SubscriptionsService {
  constructor(private readonly prisma: PrismaService) {}

  async createPending(userId: string, companyId: string, paymentId: string) {
    return this.prisma.subscription.create({
      data: {
        userId,
        companyId,
        paymentId,
        status: SubscriptionStatus.PENDING_PAYMENT,
      },
    });
  }

  async onPaymentSuccess(paymentId: string) {
    const sub = await this.prisma.subscription.findFirst({
      where: { paymentId },
    });
    if (!sub) return;

    await this.prisma.subscription.update({
      where: { id: sub.id },
      data: { status: SubscriptionStatus.PENDING_SURVEY },
    });

    await this.prisma.company.update({
      where: { id: sub.companyId },
      data: { surveyStatus: 'IN_PROGRESS' },
    });
  }

  async activateAfterSurvey(subscriptionId: string, months = 1) {
    const now = new Date();
    const ends = new Date(now);
    ends.setMonth(ends.getMonth() + months);

    return this.prisma.subscription.update({
      where: { id: subscriptionId },
      data: {
        status: SubscriptionStatus.ACTIVE,
        startsAt: now,
        endsAt: ends,
      },
    });
  }

  async getActiveSubscription(userId: string, companyId: string) {
    const now = new Date();
    return this.prisma.subscription.findFirst({
      where: {
        userId,
        companyId,
        status: SubscriptionStatus.ACTIVE,
        startsAt: { lte: now },
        endsAt: { gte: now },
      },
    });
  }

  async hasActiveCrudSubscription(userId: string, companyId: string) {
    const sub = await this.getActiveSubscription(userId, companyId);
    return !!sub;
  }

  /** Langganan aktif tingkat perusahaan (siapa pun admin yang membayar). */
  async companyHasActiveSubscription(companyId: string) {
    const now = new Date();
    const sub = await this.prisma.subscription.findFirst({
      where: {
        companyId,
        status: SubscriptionStatus.ACTIVE,
        startsAt: { lte: now },
        endsAt: { gte: now },
      },
    });
    return !!sub;
  }
}
