export const userAccountTypes = ['ADMIN', 'LEADERSHIP', 'MEMBER'] as const;
export type UserAccountType = (typeof userAccountTypes)[number];

export const companySurveyStatuses = [
  'PENDING',
  'IN_PROGRESS',
  'VERIFIED',
  'REJECTED',
] as const;
export type CompanySurveyStatus = (typeof companySurveyStatuses)[number];

export const subscriptionStatuses = [
  'PENDING_PAYMENT',
  'PENDING_SURVEY',
  'ACTIVE',
  'EXPIRED',
  'CANCELLED',
] as const;
export type SubscriptionStatus = (typeof subscriptionStatuses)[number];

export const paymentTypes = [
  'SUBSCRIPTION',
  'VIEW_ACCESS',
  'DISPUTE',
  'BLACKLIST',
  'AD',
] as const;

export const voucherAppliesTo = ['BLACKLIST', 'DISPUTE', 'VIEW_ACCESS'] as const;
export type VoucherAppliesTo = (typeof voucherAppliesTo)[number];

export const voucherBenefitTypes = ['FREE', 'PERCENT', 'FIXED'] as const;
export type VoucherBenefitType = (typeof voucherBenefitTypes)[number];

export const voucherEligibilityModes = ['ALL', 'SELECTED'] as const;
export type VoucherEligibilityMode = (typeof voucherEligibilityModes)[number];

/** Slot iklan di app WorkRecord (company profile / halaman depan), bukan panel admin. */
export const adPlacementSlots = [
  'COMPANY_PROFILE_HERO',
  'COMPANY_PROFILE_FOOTER',
] as const;
export type AdPlacementSlot = (typeof adPlacementSlots)[number];

export const broadcastAudiences = [
  'ALL_USERS',
  'COMPANY_USERS',
  'PLATFORM_OWNER',
] as const;
export type BroadcastAudience = (typeof broadcastAudiences)[number];

export const adPlacementStatuses = [
  'DRAFT',
  'PENDING_PAYMENT',
  'ACTIVE',
  'EXPIRED',
  'REJECTED',
] as const;
export type AdPlacementStatus = (typeof adPlacementStatuses)[number];
export type PaymentType = (typeof paymentTypes)[number];

export const paymentStatuses = [
  'PENDING',
  'PAID',
  'FAILED',
  'EXPIRED',
  'REFUNDED',
] as const;
export type PaymentStatus = (typeof paymentStatuses)[number];

export const viewAccessScopes = ['SINGLE_EMPLOYEE', 'ALL_COMPANY'] as const;
export type ViewAccessScope = (typeof viewAccessScopes)[number];

export const viewDurationUnits = ['HOUR', 'DAY', 'MONTH'] as const;
export type ViewDurationUnit = (typeof viewDurationUnits)[number];

export const recordChangeActions = ['CREATE', 'UPDATE', 'DELETE'] as const;
export type RecordChangeAction = (typeof recordChangeActions)[number];

export const recordChangeStatuses = [
  'PENDING_APPROVAL',
  'APPROVED',
  'REJECTED',
  'LIVE',
] as const;
export type RecordChangeStatus = (typeof recordChangeStatuses)[number];

export const disputeStatuses = [
  'OPEN',
  'INVESTIGATING',
  'RESOLVED',
  'CLOSED',
] as const;
export type DisputeStatus = (typeof disputeStatuses)[number];

export const auditActions = [
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
] as const;
export type AuditAction = (typeof auditActions)[number];
