DO $$ BEGIN
  CREATE TYPE "BlacklistStatus" AS ENUM ('ACTIVE', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

ALTER TYPE "PaymentType" ADD VALUE IF NOT EXISTS 'BLACKLIST';

CREATE TABLE IF NOT EXISTS "EmployeeBlacklist" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "companyId" uuid NOT NULL,
  "employeeProfileId" uuid,
  "employeeRecordId" uuid,
  "nationalIdNumber" text NOT NULL,
  "note" text NOT NULL,
  "paymentId" uuid NOT NULL,
  "status" "BlacklistStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdByUserId" uuid,
  "cancelledAt" timestamp,
  "cancelledByUserId" uuid,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "EmployeeBlacklist_companyId_Company_id_fk" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE cascade,
  CONSTRAINT "EmployeeBlacklist_employeeProfileId_EmployeeProfile_id_fk" FOREIGN KEY ("employeeProfileId") REFERENCES "EmployeeProfile"("id") ON DELETE SET NULL,
  CONSTRAINT "EmployeeBlacklist_employeeRecordId_EmployeeRecord_id_fk" FOREIGN KEY ("employeeRecordId") REFERENCES "EmployeeRecord"("id") ON DELETE SET NULL,
  CONSTRAINT "EmployeeBlacklist_paymentId_Payment_id_fk" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id"),
  CONSTRAINT "EmployeeBlacklist_paymentId_unique" UNIQUE("paymentId")
);

CREATE INDEX IF NOT EXISTS "EmployeeBlacklist_profile_status_idx" ON "EmployeeBlacklist" ("employeeProfileId", "status");
CREATE INDEX IF NOT EXISTS "EmployeeBlacklist_nik_status_idx" ON "EmployeeBlacklist" ("nationalIdNumber", "status");
