CREATE TABLE IF NOT EXISTS "EmployeeProfile" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "publicWorkRecordId" text NOT NULL,
  "fullName" text NOT NULL,
  "nationalIdNumber" text NOT NULL,
  "dateOfBirth" timestamp,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "EmployeeProfile_publicWorkRecordId_unique" UNIQUE("publicWorkRecordId"),
  CONSTRAINT "EmployeeProfile_nationalIdNumber_unique" UNIQUE("nationalIdNumber")
);

CREATE INDEX IF NOT EXISTS "EmployeeProfile_publicWorkRecordId_idx" ON "EmployeeProfile" ("publicWorkRecordId");

ALTER TABLE "EmployeeRecord" ADD COLUMN IF NOT EXISTS "employeeProfileId" uuid;

DO $$ BEGIN
  ALTER TABLE "EmployeeRecord"
    ADD CONSTRAINT "EmployeeRecord_employeeProfileId_EmployeeProfile_id_fk"
    FOREIGN KEY ("employeeProfileId") REFERENCES "EmployeeProfile"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "EmployeeRecord_employeeProfileId_idx" ON "EmployeeRecord" ("employeeProfileId");
