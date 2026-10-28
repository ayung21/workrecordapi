-- Satu record aktif per profil (NIK) per perusahaan; cegah duplikat dari double submit / race.
CREATE UNIQUE INDEX IF NOT EXISTS "EmployeeRecord_companyId_employeeProfileId_active_key"
  ON "EmployeeRecord" ("companyId", "employeeProfileId")
  WHERE "deletedAt" IS NULL AND "employeeProfileId" IS NOT NULL;
