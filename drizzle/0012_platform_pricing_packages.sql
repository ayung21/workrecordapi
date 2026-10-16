CREATE TABLE IF NOT EXISTS "PlatformPricing" (
  "key" text PRIMARY KEY,
  "valueJson" jsonb NOT NULL,
  "updatedAt" timestamp NOT NULL DEFAULT now(),
  "updatedByUserId" uuid REFERENCES "User"("id")
);

CREATE TABLE IF NOT EXISTS "AdPricingPackage" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" text NOT NULL UNIQUE,
  "label" text NOT NULL,
  "placement" text NOT NULL,
  "durationDays" integer NOT NULL,
  "priceIdr" numeric(12, 2) NOT NULL,
  "description" text,
  "validFrom" timestamp,
  "validUntil" timestamp,
  "isActive" boolean NOT NULL DEFAULT true,
  "sortOrder" integer NOT NULL DEFAULT 0,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);

ALTER TABLE "AdPlacement" ADD COLUMN IF NOT EXISTS "placement" text;
ALTER TABLE "AdPlacement" ADD COLUMN IF NOT EXISTS "adPackageId" uuid REFERENCES "AdPricingPackage"("id");
