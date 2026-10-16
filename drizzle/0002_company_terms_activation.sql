ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "termsVersion" text;
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "termsAcceptedAt" timestamp;
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "termsAcceptance" jsonb;
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "registeredByUserId" uuid;

DO $$ BEGIN
  ALTER TABLE "Company" ADD CONSTRAINT "Company_registeredByUserId_User_id_fk"
    FOREIGN KEY ("registeredByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "AccountActivationToken" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "userId" uuid NOT NULL,
  "tokenHash" text NOT NULL,
  "expiresAt" timestamp NOT NULL,
  "usedAt" timestamp,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "AccountActivationToken_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "AccountActivationToken_tokenHash_unique" UNIQUE("tokenHash")
);
