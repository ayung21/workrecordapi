DO $$ BEGIN
  CREATE TYPE "CompanyDocumentType" AS ENUM ('NIB', 'KTP_PENANGGUNG_JAWAB', 'AKTA');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "CompanyDocumentStatus" AS ENUM ('MISSING', 'PENDING', 'APPROVED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "CompanyOperationalStatus" AS ENUM (
    'PENDING_DOCUMENTS',
    'UNDER_REVIEW',
    'ACTIVE',
    'SUSPENDED'
  );
EXCEPTION WHEN duplicate_object THEN null;
END $$;

ALTER TYPE "PaymentType" ADD VALUE IF NOT EXISTS 'DISPUTE';

ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "operationalStatus" "CompanyOperationalStatus" NOT NULL DEFAULT 'PENDING_DOCUMENTS';

CREATE TABLE IF NOT EXISTS "CompanyDocument" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "companyId" uuid NOT NULL,
  "type" "CompanyDocumentType" NOT NULL,
  "filePath" text,
  "status" "CompanyDocumentStatus" NOT NULL DEFAULT 'MISSING',
  "rejectReason" text,
  "uploadedAt" timestamp,
  "reviewedAt" timestamp,
  "reviewedByUserId" uuid,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "CompanyDocument_companyId_Company_id_fk" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE cascade,
  CONSTRAINT "CompanyDocument_companyId_type_unique" UNIQUE("companyId","type")
);

ALTER TABLE "Dispute" ADD COLUMN IF NOT EXISTS "paymentId" uuid;
DO $$ BEGIN
  ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_paymentId_Payment_id_fk"
    FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
