ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "memberCertificateId" text;
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "memberVerifyToken" text;
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "memberCertificateExpiresAt" timestamp;

CREATE UNIQUE INDEX IF NOT EXISTS "Company_memberCertificateId_unique"
  ON "Company" ("memberCertificateId")
  WHERE "memberCertificateId" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "Company_memberVerifyToken_unique"
  ON "Company" ("memberVerifyToken")
  WHERE "memberVerifyToken" IS NOT NULL;
