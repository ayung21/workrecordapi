import { Injectable } from '@nestjs/common';
import { ViewAccessScope } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { ViewAccessService } from '../view-access/view-access.service';
import { JwtPayload } from '../auth/types/jwt-payload';

export type RecordVisibility = 'full' | 'blurred' | 'denied';

@Injectable()
export class AccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptions: SubscriptionsService,
    private readonly viewAccess: ViewAccessService,
  ) {}

  isOwner(user?: JwtPayload): boolean {
    return user?.roleCode === 'OWNER';
  }

  async canViewRecord(
    companyId: string,
    employeeRecordId: string,
    user?: JwtPayload,
    viewToken?: string,
  ): Promise<RecordVisibility> {
    if (user && this.isOwner(user)) return 'full';

    if (user?.companyId === companyId) {
      const sub = await this.subscriptions.getActiveSubscription(
        user.sub,
        companyId,
      );
      if (sub) return 'full';
    }

    if (viewToken) {
      const grant = await this.viewAccess.resolveToken(viewToken);
      if (grant && grant.companyId === companyId) {
        if (grant.scope === ViewAccessScope.ALL_COMPANY) return 'full';
        if (
          grant.scope === ViewAccessScope.SINGLE_EMPLOYEE &&
          grant.employeeRecordId === employeeRecordId
        ) {
          return 'full';
        }
      }
    }

    if (user) {
      const grants = await this.viewAccess.listGrantsForUser(user.sub);
      for (const g of grants) {
        if (g.companyId !== companyId) continue;
        if (g.scope === ViewAccessScope.ALL_COMPANY) return 'full';
        if (
          g.scope === ViewAccessScope.SINGLE_EMPLOYEE &&
          g.employeeRecordId === employeeRecordId
        ) {
          return 'full';
        }
      }
    }

    const record = await this.prisma.employeeRecord.findFirst({
      where: { id: employeeRecordId, companyId, deletedAt: null },
    });
    if (record?.isPublicPreview) return 'blurred';
    return 'denied';
  }

  async canCrudRecords(
    user: JwtPayload,
    companyId: string,
  ): Promise<{ allowed: boolean; needsApproval: boolean; reason?: string }> {
    if (this.isOwner(user)) {
      return { allowed: true, needsApproval: false };
    }

    if (user.companyId !== companyId) {
      return { allowed: false, needsApproval: false, reason: 'wrong_company' };
    }

    const hasSub = await this.subscriptions.hasActiveCrudSubscription(
      user.sub,
      companyId,
    );
    if (!hasSub) {
      return { allowed: false, needsApproval: false, reason: 'no_subscription' };
    }

    const dbUser = await this.prisma.user.findUnique({
      where: { id: user.sub },
    });
    if (!dbUser) {
      return { allowed: false, needsApproval: false, reason: 'user_not_found' };
    }

    if (dbUser.accountType === 'LEADERSHIP') {
      return { allowed: true, needsApproval: false };
    }
    if (dbUser.accountType === 'ADMIN') {
      return { allowed: true, needsApproval: true };
    }

    return { allowed: false, needsApproval: false, reason: 'forbidden' };
  }
}
