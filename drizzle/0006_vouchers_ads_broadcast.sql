ALTER TYPE "PaymentType" ADD VALUE IF NOT EXISTS 'AD';

CREATE TABLE IF NOT EXISTS "Voucher" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" text NOT NULL UNIQUE,
  "title" text NOT NULL,
  "appliesTo" text NOT NULL,
  "benefitType" text NOT NULL,
  "benefitValue" numeric(12, 2) NOT NULL DEFAULT 0,
  "maxUses" integer,
  "usedCount" integer NOT NULL DEFAULT 0,
  "expiresAt" timestamp,
  "isActive" boolean NOT NULL DEFAULT true,
  "createdByUserId" uuid REFERENCES "User"("id"),
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "VoucherRedemption" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "voucherId" uuid NOT NULL REFERENCES "Voucher"("id"),
  "paymentId" uuid REFERENCES "Payment"("id"),
  "userId" uuid REFERENCES "User"("id"),
  "createdAt" timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "BroadcastCampaign" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "subject" text NOT NULL,
  "htmlBody" text NOT NULL,
  "audience" text NOT NULL DEFAULT 'ALL_USERS',
  "recipientCount" integer NOT NULL DEFAULT 0,
  "sentAt" timestamp,
  "createdByUserId" uuid REFERENCES "User"("id"),
  "createdAt" timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "AdPlacement" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "companyId" uuid REFERENCES "Company"("id"),
  "title" text NOT NULL,
  "subtitle" text,
  "ctaLabel" text,
  "ctaUrl" text,
  "status" text NOT NULL DEFAULT 'DRAFT',
  "priceAmount" numeric(12, 2) NOT NULL DEFAULT 0,
  "paymentId" uuid REFERENCES "Payment"("id"),
  "startsAt" timestamp,
  "endsAt" timestamp,
  "sortOrder" integer NOT NULL DEFAULT 0,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);
