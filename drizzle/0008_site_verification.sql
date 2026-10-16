DO $$ BEGIN
  CREATE TYPE "CompanySiteVerificationMethod" AS ENUM ('VIDEO_CALL', 'ON_SITE');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "CompanySiteVerificationStatus" AS ENUM (
    'NOT_REQUESTED',
    'AWAITING_SCHEDULE',
    'SCHEDULED',
    'COMPLETED'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "siteVerificationMethod" "CompanySiteVerificationMethod";
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "siteVerificationStatus" "CompanySiteVerificationStatus" NOT NULL DEFAULT 'NOT_REQUESTED';
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "siteVerificationContactName" text;
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "siteVerificationContactPhone" text;
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "siteVerificationAddress" text;
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "siteVerificationPreferredNote" text;
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "siteVerificationScheduledAt" timestamp;
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "siteVerificationMeetingUrl" text;
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "siteVerificationAdminNotes" text;
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "siteVerificationCompletedAt" timestamp;

UPDATE "Company"
SET "siteVerificationStatus" = 'COMPLETED',
    "siteVerificationCompletedAt" = COALESCE("verifiedAt", NOW())
WHERE "operationalStatus" = 'ACTIVE'
  AND "siteVerificationStatus" = 'NOT_REQUESTED';
