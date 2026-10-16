ALTER TABLE "Voucher" ADD COLUMN IF NOT EXISTS "eligibilityMode" text NOT NULL DEFAULT 'ALL';
ALTER TABLE "Voucher" ADD COLUMN IF NOT EXISTS "maxUsesPerCompany" integer;

ALTER TABLE "VoucherRedemption" ADD COLUMN IF NOT EXISTS "companyId" uuid REFERENCES "Company"("id");

CREATE TABLE IF NOT EXISTS "VoucherCompany" (
  "voucherId" uuid NOT NULL REFERENCES "Voucher"("id") ON DELETE CASCADE,
  "companyId" uuid NOT NULL REFERENCES "Company"("id") ON DELETE CASCADE,
  PRIMARY KEY ("voucherId", "companyId")
);
