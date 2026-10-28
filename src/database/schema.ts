import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

export const userAccountTypeEnum = pgEnum('UserAccountType', [
  'ADMIN',
  'LEADERSHIP',
  'MEMBER',
]);
export const companySurveyStatusEnum = pgEnum('CompanySurveyStatus', [
  'PENDING',
  'IN_PROGRESS',
  'VERIFIED',
  'REJECTED',
]);
export const subscriptionStatusEnum = pgEnum('SubscriptionStatus', [
  'PENDING_PAYMENT',
  'PENDING_SURVEY',
  'ACTIVE',
  'EXPIRED',
  'CANCELLED',
]);
export const paymentTypeEnum = pgEnum('PaymentType', [
  'SUBSCRIPTION',
  'VIEW_ACCESS',
  'DISPUTE',
  'BLACKLIST',
  'AD',
]);
export const blacklistStatusEnum = pgEnum('BlacklistStatus', [
  'ACTIVE',
  'CANCELLED',
]);
export const companyDocumentTypeEnum = pgEnum('CompanyDocumentType', [
  'NIB',
  'KTP_PENANGGUNG_JAWAB',
  'AKTA',
]);
export const companyDocumentStatusEnum = pgEnum('CompanyDocumentStatus', [
  'MISSING',
  'PENDING',
  'APPROVED',
  'REJECTED',
]);
export const companyOperationalStatusEnum = pgEnum('CompanyOperationalStatus', [
  'PENDING_DOCUMENTS',
  'UNDER_REVIEW',
  'ACTIVE',
  'SUSPENDED',
]);
export const companySiteVerificationMethodEnum = pgEnum(
  'CompanySiteVerificationMethod',
  ['VIDEO_CALL', 'ON_SITE'],
);
export const companySiteVerificationStatusEnum = pgEnum(
  'CompanySiteVerificationStatus',
  ['NOT_REQUESTED', 'AWAITING_SCHEDULE', 'SCHEDULED', 'COMPLETED'],
);
export const paymentStatusEnum = pgEnum('PaymentStatus', [
  'PENDING',
  'PAID',
  'FAILED',
  'EXPIRED',
  'REFUNDED',
]);
export const viewAccessScopeEnum = pgEnum('ViewAccessScope', [
  'SINGLE_EMPLOYEE',
  'ALL_COMPANY',
]);
export const viewDurationUnitEnum = pgEnum('ViewDurationUnit', [
  'HOUR',
  'DAY',
  'MONTH',
]);
export const recordChangeActionEnum = pgEnum('RecordChangeAction', [
  'CREATE',
  'UPDATE',
  'DELETE',
  'BLACKLIST',
]);
export const recordChangeStatusEnum = pgEnum('RecordChangeStatus', [
  'PENDING_APPROVAL',
  'APPROVED',
  'REJECTED',
  'LIVE',
]);
export const disputeStatusEnum = pgEnum('DisputeStatus', [
  'OPEN',
  'INVESTIGATING',
  'RESOLVED',
  'CLOSED',
]);
export const auditActionEnum = pgEnum('AuditAction', [
  'AUTH_LOGIN',
  'AUTH_ADMIN_LOGIN',
  'AUTH_ADMIN_LOGIN_DENIED',
  'AUTH_PASSWORD_CHANGE',
  'COMPANY_REGISTER',
  'COMPANY_SURVEY_UPDATE',
  'LEADERSHIP_INVITE',
  'SUBSCRIPTION_ACTIVATED',
  'PAYMENT_COMPLETED',
  'RECORD_CREATE',
  'RECORD_UPDATE',
  'RECORD_DELETE',
  'RECORD_CHANGE_APPROVED',
  'RECORD_CHANGE_REJECTED',
  'VIEW_ACCESS_GRANTED',
  'DISPUTE_CREATED',
  'DISPUTE_STATUS_UPDATE',
]);

export const roleGroups = pgTable('RoleGroup', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  description: text('description'),
  isSystem: boolean('isSystem').notNull().default(false),
  createdAt: timestamp('createdAt', { mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updatedAt', { mode: 'date' }).notNull().defaultNow(),
});

export const roles = pgTable('Role', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  description: text('description'),
  roleGroupId: uuid('roleGroupId')
    .notNull()
    .references(() => roleGroups.id),
  isSystem: boolean('isSystem').notNull().default(false),
  createdAt: timestamp('createdAt', { mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updatedAt', { mode: 'date' }).notNull().defaultNow(),
});

export const permissions = pgTable('Permission', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  description: text('description'),
  createdAt: timestamp('createdAt', { mode: 'date' }).notNull().defaultNow(),
});

export const rolePermissions = pgTable(
  'RolePermission',
  {
    roleId: uuid('roleId')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permissionId: uuid('permissionId')
      .notNull()
      .references(() => permissions.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permissionId] })],
);

export const companies = pgTable('Company', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  companyPhone: text('companyPhone').notNull(),
  /** Bidang usaha — ditampilkan di sertifikat member; diubah oleh Pimpinan. */
  businessField: text('businessField'),
  adminPublicId: text('adminPublicId').notNull().unique(),
  leaderPublicId: text('leaderPublicId').unique(),
  leadershipInvitedAt: timestamp('leadershipInvitedAt', { mode: 'date' }),
  surveyStatus: companySurveyStatusEnum('surveyStatus')
    .notNull()
    .default('PENDING'),
  surveyNotes: text('surveyNotes'),
  verifiedAt: timestamp('verifiedAt', { mode: 'date' }),
  termsVersion: text('termsVersion'),
  termsAcceptedAt: timestamp('termsAcceptedAt', { mode: 'date' }),
  termsAcceptance: jsonb('termsAcceptance'),
  registeredByUserId: uuid('registeredByUserId'),
  operationalStatus: companyOperationalStatusEnum('operationalStatus')
    .notNull()
    .default('PENDING_DOCUMENTS'),
  siteVerificationMethod: companySiteVerificationMethodEnum(
    'siteVerificationMethod',
  ),
  siteVerificationStatus: companySiteVerificationStatusEnum(
    'siteVerificationStatus',
  )
    .notNull()
    .default('NOT_REQUESTED'),
  siteVerificationContactName: text('siteVerificationContactName'),
  siteVerificationContactPhone: text('siteVerificationContactPhone'),
  siteVerificationAddress: text('siteVerificationAddress'),
  siteVerificationPreferredNote: text('siteVerificationPreferredNote'),
  siteVerificationScheduledAt: timestamp('siteVerificationScheduledAt', {
    mode: 'date',
  }),
  siteVerificationMeetingUrl: text('siteVerificationMeetingUrl'),
  siteVerificationAdminNotes: text('siteVerificationAdminNotes'),
  siteVerificationCompletedAt: timestamp('siteVerificationCompletedAt', {
    mode: 'date',
  }),
  isActive: boolean('isActive').notNull().default(true),
  memberCertificateId: text('memberCertificateId'),
  memberVerifyToken: text('memberVerifyToken'),
  memberCertificateExpiresAt: timestamp('memberCertificateExpiresAt', {
    mode: 'date',
  }),
  createdAt: timestamp('createdAt', { mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updatedAt', { mode: 'date' }).notNull().defaultNow(),
});

export const companyDocuments = pgTable(
  'CompanyDocument',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('companyId')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    type: companyDocumentTypeEnum('type').notNull(),
    filePath: text('filePath'),
    status: companyDocumentStatusEnum('status').notNull().default('MISSING'),
    rejectReason: text('rejectReason'),
    uploadedAt: timestamp('uploadedAt', { mode: 'date' }),
    reviewedAt: timestamp('reviewedAt', { mode: 'date' }),
    reviewedByUserId: uuid('reviewedByUserId'),
    createdAt: timestamp('createdAt', { mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    index('CompanyDocument_companyId_idx').on(t.companyId),
    unique('CompanyDocument_companyId_type_unique').on(t.companyId, t.type),
  ],
);

export const users = pgTable('User', {
  id: uuid('id').primaryKey().defaultRandom(),
  publicLoginId: text('publicLoginId').notNull().unique(),
  email: text('email').notNull().unique(),
  emailVerifiedAt: timestamp('emailVerifiedAt', { mode: 'date' }),
  passwordHash: text('passwordHash').notNull(),
  fullName: text('fullName').notNull(),
  personalPhone: text('personalPhone'),
  accountType: userAccountTypeEnum('accountType').notNull().default('MEMBER'),
  roleId: uuid('roleId')
    .notNull()
    .references(() => roles.id),
  companyId: uuid('companyId').references(() => companies.id),
  isActive: boolean('isActive').notNull().default(true),
  createdAt: timestamp('createdAt', { mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updatedAt', { mode: 'date' }).notNull().defaultNow(),
});

export const payments = pgTable('Payment', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('userId').references(() => users.id),
  companyId: uuid('companyId').references(() => companies.id),
  type: paymentTypeEnum('type').notNull(),
  status: paymentStatusEnum('status').notNull().default('PENDING'),
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  currency: text('currency').notNull().default('IDR'),
  gateway: text('gateway').notNull().default('mock'),
  gatewayOrderId: text('gatewayOrderId').notNull().unique(),
  gatewayTxnId: text('gatewayTxnId'),
  metadata: jsonb('metadata'),
  paidAt: timestamp('paidAt', { mode: 'date' }),
  createdAt: timestamp('createdAt', { mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updatedAt', { mode: 'date' }).notNull().defaultNow(),
});

export const subscriptions = pgTable(
  'Subscription',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('userId')
      .notNull()
      .references(() => users.id),
    companyId: uuid('companyId')
      .notNull()
      .references(() => companies.id),
    status: subscriptionStatusEnum('status')
      .notNull()
      .default('PENDING_PAYMENT'),
    startsAt: timestamp('startsAt', { mode: 'date' }),
    endsAt: timestamp('endsAt', { mode: 'date' }),
    paymentId: uuid('paymentId')
      .unique()
      .references(() => payments.id),
    createdAt: timestamp('createdAt', { mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    index('Subscription_userId_companyId_idx').on(t.userId, t.companyId),
    index('Subscription_status_endsAt_idx').on(t.status, t.endsAt),
  ],
);

export const employeeProfiles = pgTable(
  'EmployeeProfile',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    publicWorkRecordId: text('publicWorkRecordId').notNull().unique(),
    fullName: text('fullName').notNull(),
    nationalIdNumber: text('nationalIdNumber').notNull().unique(),
    placeOfBirth: text('placeOfBirth'),
    dateOfBirth: timestamp('dateOfBirth', { mode: 'date' }),
    createdAt: timestamp('createdAt', { mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    index('EmployeeProfile_publicWorkRecordId_idx').on(t.publicWorkRecordId),
  ],
);

export const employeeRecords = pgTable(
  'EmployeeRecord',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('companyId')
      .notNull()
      .references(() => companies.id),
    employeeProfileId: uuid('employeeProfileId').references(
      () => employeeProfiles.id,
    ),
    employeeName: text('employeeName').notNull(),
    /** Nomor ID karyawan internal perusahaan — bukan NIK KTP (lihat EmployeeProfile.nationalIdNumber). */
    employeeIdNumber: text('employeeIdNumber'),
    position: text('position'),
    photoPath: text('photoPath'),
    joinedAt: timestamp('joinedAt', { mode: 'date' }),
    leftAt: timestamp('leftAt', { mode: 'date' }),
    conductSummary: text('conductSummary'),
    violationNotes: text('violationNotes'),
    isPublicPreview: boolean('isPublicPreview').notNull().default(true),
    deletedAt: timestamp('deletedAt', { mode: 'date' }),
    liveData: jsonb('liveData'),
    createdAt: timestamp('createdAt', { mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    index('EmployeeRecord_companyId_idx').on(t.companyId),
    index('EmployeeRecord_deletedAt_idx').on(t.deletedAt),
    index('EmployeeRecord_employeeProfileId_idx').on(t.employeeProfileId),
  ],
);

export const viewAccessGrants = pgTable(
  'ViewAccessGrant',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tokenHash: text('tokenHash').notNull().unique(),
    email: text('email').notNull(),
    userId: uuid('userId').references(() => users.id),
    paymentId: uuid('paymentId')
      .notNull()
      .unique()
      .references(() => payments.id),
    scope: viewAccessScopeEnum('scope').notNull(),
    companyId: uuid('companyId').notNull(),
    employeeRecordId: uuid('employeeRecordId').references(
      () => employeeRecords.id,
    ),
    durationUnit: viewDurationUnitEnum('durationUnit').notNull(),
    durationValue: integer('durationValue').notNull(),
    startsAt: timestamp('startsAt', { mode: 'date' }).notNull().defaultNow(),
    endsAt: timestamp('endsAt', { mode: 'date' }).notNull(),
    createdAt: timestamp('createdAt', { mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    index('ViewAccessGrant_endsAt_idx').on(t.endsAt),
    index('ViewAccessGrant_companyId_idx').on(t.companyId),
  ],
);

export const recordChangeRequests = pgTable(
  'RecordChangeRequest',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('companyId')
      .notNull()
      .references(() => companies.id),
    employeeRecordId: uuid('employeeRecordId').references(
      () => employeeRecords.id,
    ),
    action: recordChangeActionEnum('action').notNull(),
    status: recordChangeStatusEnum('status')
      .notNull()
      .default('PENDING_APPROVAL'),
    payload: jsonb('payload').notNull(),
    requestedById: uuid('requestedById')
      .notNull()
      .references(() => users.id),
    approvedById: uuid('approvedById').references(() => users.id),
    rejectionReason: text('rejectionReason'),
    createdAt: timestamp('createdAt', { mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { mode: 'date' }).notNull().defaultNow(),
    appliedAt: timestamp('appliedAt', { mode: 'date' }),
  },
  (t) => [
    index('RecordChangeRequest_companyId_status_idx').on(
      t.companyId,
      t.status,
    ),
  ],
);

export const emailVerificationTokens = pgTable('EmailVerificationToken', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('userId')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('tokenHash').notNull().unique(),
  newEmail: text('newEmail'),
  expiresAt: timestamp('expiresAt', { mode: 'date' }).notNull(),
  usedAt: timestamp('usedAt', { mode: 'date' }),
  createdAt: timestamp('createdAt', { mode: 'date' }).notNull().defaultNow(),
});

export const passwordResetTokens = pgTable('PasswordResetToken', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('userId')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('tokenHash').notNull().unique(),
  expiresAt: timestamp('expiresAt', { mode: 'date' }).notNull(),
  usedAt: timestamp('usedAt', { mode: 'date' }),
  createdAt: timestamp('createdAt', { mode: 'date' }).notNull().defaultNow(),
});

export const accountActivationTokens = pgTable('AccountActivationToken', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('userId')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('tokenHash').notNull().unique(),
  expiresAt: timestamp('expiresAt', { mode: 'date' }).notNull(),
  usedAt: timestamp('usedAt', { mode: 'date' }),
  createdAt: timestamp('createdAt', { mode: 'date' }).notNull().defaultNow(),
});

export const employeeBlacklists = pgTable(
  'EmployeeBlacklist',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('companyId')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    employeeProfileId: uuid('employeeProfileId').references(
      () => employeeProfiles.id,
    ),
    employeeRecordId: uuid('employeeRecordId').references(
      () => employeeRecords.id,
    ),
    nationalIdNumber: text('nationalIdNumber').notNull(),
    note: text('note').notNull(),
    paymentId: uuid('paymentId')
      .notNull()
      .unique()
      .references(() => payments.id),
    status: blacklistStatusEnum('status').notNull().default('ACTIVE'),
    createdByUserId: uuid('createdByUserId').references(() => users.id),
    cancelledAt: timestamp('cancelledAt', { mode: 'date' }),
    cancelledByUserId: uuid('cancelledByUserId').references(() => users.id),
    createdAt: timestamp('createdAt', { mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    index('EmployeeBlacklist_profile_status_idx').on(
      t.employeeProfileId,
      t.status,
    ),
    index('EmployeeBlacklist_nik_status_idx').on(
      t.nationalIdNumber,
      t.status,
    ),
  ],
);

export const disputes = pgTable(
  'Dispute',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('companyId')
      .notNull()
      .references(() => companies.id),
    employeeRecordId: uuid('employeeRecordId').references(
      () => employeeRecords.id,
    ),
    reporterUserId: uuid('reporterUserId').references(() => users.id),
    reporterEmail: text('reporterEmail').notNull(),
    description: text('description').notNull(),
    paymentId: uuid('paymentId').references(() => payments.id),
    status: disputeStatusEnum('status').notNull().default('OPEN'),
    resolutionNotes: text('resolutionNotes'),
    createdAt: timestamp('createdAt', { mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [index('Dispute_companyId_status_idx').on(t.companyId, t.status)],
);

export const vouchers = pgTable('Voucher', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(),
  title: text('title').notNull(),
  appliesTo: text('appliesTo').notNull(),
  benefitType: text('benefitType').notNull(),
  benefitValue: numeric('benefitValue', { precision: 12, scale: 2 })
    .notNull()
    .default('0'),
  maxUses: integer('maxUses'),
  maxUsesPerCompany: integer('maxUsesPerCompany'),
  eligibilityMode: text('eligibilityMode').notNull().default('ALL'),
  usedCount: integer('usedCount').notNull().default(0),
  expiresAt: timestamp('expiresAt', { mode: 'date' }),
  isActive: boolean('isActive').notNull().default(true),
  createdByUserId: uuid('createdByUserId').references(() => users.id),
  createdAt: timestamp('createdAt', { mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updatedAt', { mode: 'date' }).notNull().defaultNow(),
});

export const voucherCompanies = pgTable(
  'VoucherCompany',
  {
    voucherId: uuid('voucherId')
      .notNull()
      .references(() => vouchers.id, { onDelete: 'cascade' }),
    companyId: uuid('companyId')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.voucherId, t.companyId] })],
);

export const voucherRedemptions = pgTable('VoucherRedemption', {
  id: uuid('id').primaryKey().defaultRandom(),
  voucherId: uuid('voucherId')
    .notNull()
    .references(() => vouchers.id),
  paymentId: uuid('paymentId').references(() => payments.id),
  userId: uuid('userId').references(() => users.id),
  companyId: uuid('companyId').references(() => companies.id),
  createdAt: timestamp('createdAt', { mode: 'date' }).notNull().defaultNow(),
});

export const broadcastCampaigns = pgTable('BroadcastCampaign', {
  id: uuid('id').primaryKey().defaultRandom(),
  subject: text('subject').notNull(),
  htmlBody: text('htmlBody').notNull(),
  audience: text('audience').notNull().default('ALL_USERS'),
  recipientCount: integer('recipientCount').notNull().default(0),
  sentAt: timestamp('sentAt', { mode: 'date' }),
  createdByUserId: uuid('createdByUserId').references(() => users.id),
  createdAt: timestamp('createdAt', { mode: 'date' }).notNull().defaultNow(),
});

export const platformPricing = pgTable('PlatformPricing', {
  key: text('key').primaryKey(),
  valueJson: jsonb('valueJson').notNull(),
  updatedAt: timestamp('updatedAt', { mode: 'date' }).notNull().defaultNow(),
  updatedByUserId: uuid('updatedByUserId').references(() => users.id),
});

export const adPricingPackages = pgTable('AdPricingPackage', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(),
  label: text('label').notNull(),
  placement: text('placement').notNull(),
  durationDays: integer('durationDays').notNull(),
  priceIdr: numeric('priceIdr', { precision: 12, scale: 2 }).notNull(),
  description: text('description'),
  validFrom: timestamp('validFrom', { mode: 'date' }),
  validUntil: timestamp('validUntil', { mode: 'date' }),
  isActive: boolean('isActive').notNull().default(true),
  sortOrder: integer('sortOrder').notNull().default(0),
  createdAt: timestamp('createdAt', { mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updatedAt', { mode: 'date' }).notNull().defaultNow(),
});

export const adPlacements = pgTable('AdPlacement', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('companyId').references(() => companies.id),
  adPackageId: uuid('adPackageId').references(() => adPricingPackages.id),
  placement: text('placement'),
  title: text('title').notNull(),
  subtitle: text('subtitle'),
  ctaLabel: text('ctaLabel'),
  ctaUrl: text('ctaUrl'),
  status: text('status').notNull().default('DRAFT'),
  priceAmount: numeric('priceAmount', { precision: 12, scale: 2 })
    .notNull()
    .default('0'),
  paymentId: uuid('paymentId').references(() => payments.id),
  startsAt: timestamp('startsAt', { mode: 'date' }),
  endsAt: timestamp('endsAt', { mode: 'date' }),
  sortOrder: integer('sortOrder').notNull().default(0),
  bannerImagePath: text('bannerImagePath'),
  createdAt: timestamp('createdAt', { mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updatedAt', { mode: 'date' }).notNull().defaultNow(),
});

export const auditLogs = pgTable(
  'AuditLog',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    action: auditActionEnum('action').notNull(),
    actorUserId: uuid('actorUserId'),
    companyId: uuid('companyId'),
    entityType: text('entityType'),
    entityId: text('entityId'),
    ipAddress: text('ipAddress'),
    userAgent: text('userAgent'),
    metadata: jsonb('metadata'),
    createdAt: timestamp('createdAt', { mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    index('AuditLog_companyId_createdAt_idx').on(t.companyId, t.createdAt),
    index('AuditLog_actorUserId_createdAt_idx').on(
      t.actorUserId,
      t.createdAt,
    ),
    index('AuditLog_action_createdAt_idx').on(t.action, t.createdAt),
  ],
);

export const rolesRelations = relations(roles, ({ one, many }) => ({
  roleGroup: one(roleGroups, {
    fields: [roles.roleGroupId],
    references: [roleGroups.id],
  }),
  rolePermissions: many(rolePermissions),
  users: many(users),
}));

export const rolePermissionsRelations = relations(
  rolePermissions,
  ({ one }) => ({
    role: one(roles, {
      fields: [rolePermissions.roleId],
      references: [roles.id],
    }),
    permission: one(permissions, {
      fields: [rolePermissions.permissionId],
      references: [permissions.id],
    }),
  }),
);

export const usersRelations = relations(users, ({ one }) => ({
  role: one(roles, { fields: [users.roleId], references: [roles.id] }),
  company: one(companies, {
    fields: [users.companyId],
    references: [companies.id],
  }),
}));

export const employeeProfilesRelations = relations(
  employeeProfiles,
  ({ many }) => ({
    records: many(employeeRecords),
  }),
);

export const employeeRecordsRelations = relations(
  employeeRecords,
  ({ one }) => ({
    profile: one(employeeProfiles, {
      fields: [employeeRecords.employeeProfileId],
      references: [employeeProfiles.id],
    }),
    company: one(companies, {
      fields: [employeeRecords.companyId],
      references: [companies.id],
    }),
  }),
);

export const schema = {
  roleGroups,
  roles,
  permissions,
  rolePermissions,
  companies,
  companyDocuments,
  users,
  payments,
  subscriptions,
  employeeProfiles,
  employeeRecords,
  employeeBlacklists,
  viewAccessGrants,
  recordChangeRequests,
  emailVerificationTokens,
  passwordResetTokens,
  accountActivationTokens,
  disputes,
  auditLogs,
  rolesRelations,
  rolePermissionsRelations,
  usersRelations,
  employeeProfilesRelations,
  employeeRecordsRelations,
};
