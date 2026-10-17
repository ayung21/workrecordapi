import 'dotenv/config';
import * as bcrypt from 'bcrypt';
import { drizzle } from 'drizzle-orm/node-postgres';
import { and, eq } from 'drizzle-orm';
import { Pool } from 'pg';
import { resolveDatabaseUrl } from '../src/database/database-url';
import {
  companies,
  companyDocuments,
  disputes,
  employeeProfiles,
  employeeRecords,
  payments,
  subscriptions,
  users,
} from '../src/database/schema';
import { schema } from '../src/database/schema';
import { seedSystem } from './seed-system';

const DUMMY_PASSWORD = 'DummyPass123!';
const MARKER_ADMIN_ID = 'ADM-DUMMYMAJU';
const MARKER_MAJU_BERSAMA = 'ADM-DUMMYBERSAMA';

const PROFILE_SEEDS = [
  {
    key: 'andi',
    publicWorkRecordId: 'WR-00001001',
    fullName: 'Andi Wijaya',
    nationalIdNumber: '3301121990010001',
    dateOfBirth: new Date('1990-01-15'),
  },
  {
    key: 'dewi',
    publicWorkRecordId: 'WR-00001002',
    fullName: 'Dewi Lestari',
    nationalIdNumber: '3302121992052002',
    dateOfBirth: new Date('1992-05-20'),
  },
  {
    key: 'siti',
    publicWorkRecordId: 'WR-00001245',
    fullName: 'Siti Aminah',
    nationalIdNumber: '3578019980123456',
    dateOfBirth: new Date('1998-05-12'),
  },
] as const;

async function upsertProfiles(db: ReturnType<typeof drizzle<typeof schema>>) {
  const allProfiles = [
    ...PROFILE_SEEDS,
    {
      key: 'rizky' as const,
      publicWorkRecordId: 'WR-00001003',
      fullName: 'Rizky Pratama',
      nationalIdNumber: '3303121995030003',
      dateOfBirth: new Date('1995-03-03'),
    },
    {
      key: 'nina' as const,
      publicWorkRecordId: 'WR-00001004',
      fullName: 'Nina Kartika',
      nationalIdNumber: '3304121988050404',
      dateOfBirth: new Date('1988-05-04'),
    },
    {
      key: 'bambang' as const,
      publicWorkRecordId: 'WR-00001005',
      fullName: 'Bambang Santoso',
      nationalIdNumber: '3305121987040505',
      dateOfBirth: new Date('1987-04-05'),
    },
    {
      key: 'fitri' as const,
      publicWorkRecordId: 'WR-00001006',
      fullName: 'Fitri Handayani',
      nationalIdNumber: '3306121994060606',
      dateOfBirth: new Date('1994-06-06'),
    },
    {
      key: 'hendra' as const,
      publicWorkRecordId: 'WR-00001007',
      fullName: 'Hendra Gunawan',
      nationalIdNumber: '3307121989110707',
      dateOfBirth: new Date('1989-11-07'),
    },
    {
      key: 'putri' as const,
      publicWorkRecordId: 'WR-00001008',
      fullName: 'Putri Maharani',
      nationalIdNumber: '3308122000020808',
      dateOfBirth: new Date('2000-02-08'),
    },
    {
      key: 'agus' as const,
      publicWorkRecordId: 'WR-00001009',
      fullName: 'Agus Salim',
      nationalIdNumber: '3309121983070909',
      dateOfBirth: new Date('1983-07-09'),
    },
    {
      key: 'maya' as const,
      publicWorkRecordId: 'WR-00001010',
      fullName: 'Maya Sari',
      nationalIdNumber: '3310121996081010',
      dateOfBirth: new Date('1996-08-10'),
    },
  ];

  const byKey = new Map<string, string>();
  for (const p of allProfiles) {
    const [row] = await db
      .insert(employeeProfiles)
      .values({
        publicWorkRecordId: p.publicWorkRecordId,
        fullName: p.fullName,
        nationalIdNumber: p.nationalIdNumber,
        dateOfBirth: p.dateOfBirth,
      })
      .onConflictDoUpdate({
        target: employeeProfiles.nationalIdNumber,
        set: {
          publicWorkRecordId: p.publicWorkRecordId,
          fullName: p.fullName,
          dateOfBirth: p.dateOfBirth,
          updatedAt: new Date(),
        },
      })
      .returning();
    byKey.set(p.key, row.id);
  }
  return byKey;
}

function fullDummyRows(companyId: string): Array<{
  companyId: string;
  profileKey: string;
  employeeCode: string;
  employeeName: string;
  position: string;
  joinedAt: Date;
  leftAt?: Date;
  conductSummary: string;
  violationNotes?: string | null;
  isPublicPreview: boolean;
}> {
  return [
    {
      companyId,
      profileKey: 'andi',
      employeeCode: 'EMP-001',
      employeeName: 'Andi Wijaya',
      position: 'Staff Administrasi',
      joinedAt: new Date('2022-03-01'),
      leftAt: new Date('2024-08-15'),
      conductSummary:
        'Menyelesaikan tugas administrasi dengan baik. Tidak ada pelanggaran berat.',
      isPublicPreview: true,
    },
    {
      companyId,
      profileKey: 'dewi',
      employeeCode: 'EMP-002',
      employeeName: 'Dewi Lestari',
      position: 'Admin Operasional',
      joinedAt: new Date('2021-06-10'),
      conductSummary:
        'Performa baik. Pernah teguran ringan terkait keterlambatan absen (2023).',
      violationNotes: 'Teguran tertulis: keterlambatan berulang Q2 2023.',
      isPublicPreview: true,
    },
    {
      companyId,
      profileKey: 'rizky',
      employeeCode: 'EMP-003',
      employeeName: 'Rizky Pratama',
      position: 'Operator Produksi',
      joinedAt: new Date('2023-01-20'),
      conductSummary: 'Masih aktif. Disiplin kerja baik.',
      isPublicPreview: true,
    },
    {
      companyId,
      profileKey: 'nina',
      employeeCode: 'EMP-004',
      employeeName: 'Nina Kartika',
      position: 'HR Officer',
      joinedAt: new Date('2020-01-05'),
      leftAt: new Date('2022-12-31'),
      conductSummary: 'Kontrak selesai normal. Rekomendasi positif.',
      isPublicPreview: false,
    },
    {
      companyId,
      profileKey: 'bambang',
      employeeCode: 'EMP-005',
      employeeName: 'Bambang Santoso',
      position: 'Supervisor Gudang',
      joinedAt: new Date('2019-04-12'),
      leftAt: new Date('2025-01-10'),
      conductSummary:
        'Kepemimpinan tim gudang baik. Serah terima aset lengkap saat resign.',
      isPublicPreview: true,
    },
    {
      companyId,
      profileKey: 'fitri',
      employeeCode: 'EMP-006',
      employeeName: 'Fitri Handayani',
      position: 'Akuntan',
      joinedAt: new Date('2022-09-01'),
      conductSummary: 'Akurasi laporan keuangan baik. Masih aktif.',
      isPublicPreview: true,
    },
    {
      companyId,
      profileKey: 'hendra',
      employeeCode: 'EMP-007',
      employeeName: 'Hendra Gunawan',
      position: 'Driver',
      joinedAt: new Date('2020-11-03'),
      leftAt: new Date('2023-05-20'),
      conductSummary: 'Disiplin rute dan perawatan kendaraan baik.',
      violationNotes:
        'Surat peringatan: kecelakaan ringan karena kelalaian (2022).',
      isPublicPreview: true,
    },
    {
      companyId,
      profileKey: 'putri',
      employeeCode: 'EMP-008',
      employeeName: 'Putri Maharani',
      position: 'Customer Service',
      joinedAt: new Date('2024-02-15'),
      conductSummary: 'Komunikasi dengan klien baik. Tidak ada komplain serius.',
      isPublicPreview: true,
    },
    {
      companyId,
      profileKey: 'agus',
      employeeCode: 'EMP-009',
      employeeName: 'Agus Salim',
      position: 'Teknisi Maintenance',
      joinedAt: new Date('2018-07-20'),
      leftAt: new Date('2024-11-30'),
      conductSummary:
        'Keahlian teknis kuat. Kontrak diakhiri karena restrukturisasi.',
      isPublicPreview: true,
    },
    {
      companyId,
      profileKey: 'maya',
      employeeCode: 'EMP-010',
      employeeName: 'Maya Sari',
      position: 'Marketing Staff',
      joinedAt: new Date('2023-08-01'),
      leftAt: new Date('2024-03-14'),
      conductSummary:
        'Target penjualan tercapai. Resign mengikuti pasangan pindah kota.',
      isPublicPreview: true,
    },
  ];
}

async function ensureCompanyEmployees(
  db: ReturnType<typeof drizzle<typeof schema>>,
  companyId: string,
  profileIds: Map<string, string>,
) {
  let added = 0;
  for (const row of fullDummyRows(companyId)) {
    const found = await db.query.employeeRecords.findFirst({
      where: and(
        eq(employeeRecords.companyId, companyId),
        eq(employeeRecords.employeeIdNumber, row.employeeCode),
      ),
    });
    const profileId = profileIds.get(row.profileKey);
    if (!found) {
      await db.insert(employeeRecords).values({
        companyId: row.companyId,
        employeeProfileId: profileId,
        employeeName: row.employeeName,
        employeeIdNumber: row.employeeCode,
        position: row.position,
        joinedAt: row.joinedAt,
        leftAt: row.leftAt,
        conductSummary: row.conductSummary,
        violationNotes: row.violationNotes ?? null,
        isPublicPreview: row.isPublicPreview,
      });
      added++;
    } else if (!found.employeeProfileId && profileId) {
      await db
        .update(employeeRecords)
        .set({ employeeProfileId: profileId, updatedAt: new Date() })
        .where(eq(employeeRecords.id, found.id));
    }
  }
  return added;
}

async function ensureSitiShowcase(
  db: ReturnType<typeof drizzle<typeof schema>>,
  profileIds: Map<string, string>,
  companyMajuId: string,
  companyContohId: string,
  companyBlurId: string,
) {
  const sitiProfileId = profileIds.get('siti');
  if (!sitiProfileId) return;

  const sitiRows = [
    {
      companyId: companyMajuId,
      employeeCode: 'EMP-SITI-MAJU',
      position: 'Staff Administrasi',
      joinedAt: new Date('2024-01-10'),
      leftAt: new Date('2026-06-30'),
      conductSummary: 'Mengundurkan diri sebelum kontrak berakhir.',
      isPublicPreview: true,
      withDispute: true,
    },
    {
      companyId: companyContohId,
      employeeCode: 'EMP-SITI-CONTOH',
      position: 'Admin Operasional',
      joinedAt: new Date('2021-03-01'),
      leftAt: new Date('2023-12-15'),
      conductSummary: 'Menyelesaikan masa kerja dengan baik.',
      isPublicPreview: true,
      withDispute: false,
    },
    {
      companyId: companyBlurId,
      employeeCode: 'EMP-SITI-BLUR',
      position: 'Staff Pendukung',
      joinedAt: new Date('2020-06-01'),
      leftAt: new Date('2021-02-28'),
      conductSummary: 'Kontrak proyek singkat.',
      isPublicPreview: true,
      withDispute: false,
    },
  ];

  for (const row of sitiRows) {
    let record = await db.query.employeeRecords.findFirst({
      where: and(
        eq(employeeRecords.companyId, row.companyId),
        eq(employeeRecords.employeeIdNumber, row.employeeCode),
      ),
    });
    if (!record) {
      const [created] = await db
        .insert(employeeRecords)
        .values({
          companyId: row.companyId,
          employeeProfileId: sitiProfileId,
          employeeName: 'Siti Aminah',
          employeeIdNumber: row.employeeCode,
          position: row.position,
          joinedAt: row.joinedAt,
          leftAt: row.leftAt,
          conductSummary: row.conductSummary,
          isPublicPreview: row.isPublicPreview,
        })
        .returning();
      record = created;
    } else if (!record.employeeProfileId) {
      await db
        .update(employeeRecords)
        .set({ employeeProfileId: sitiProfileId, updatedAt: new Date() })
        .where(eq(employeeRecords.id, record.id));
    }

    if (row.withDispute && record) {
      const dispute = await db.query.disputes.findFirst({
        where: eq(disputes.employeeRecordId, record.id),
      });
      if (!dispute) {
        await db.insert(disputes).values({
          companyId: row.companyId,
          employeeRecordId: record.id,
          reporterEmail: 'siti.aminah@example.local',
          description:
            'Sanggahan terhadap tanggal berakhir kerja pada record perusahaan.',
          status: 'OPEN',
        });
      }
    }
  }
}

async function ensureMajuBersamaCompany(
  db: ReturnType<typeof drizzle<typeof schema>>,
  adminRoleId: string,
) {
  const existing = await db.query.companies.findFirst({
    where: eq(companies.adminPublicId, MARKER_MAJU_BERSAMA),
  });
  if (existing) return existing;

  const passwordHash = await bcrypt.hash(DUMMY_PASSWORD, 12);
  const now = new Date();
  const subEnds = new Date(now);
  subEnds.setMonth(subEnds.getMonth() + 3);

  const [company] = await db
    .insert(companies)
    .values({
      name: 'PT Maju Bersama Indonesia',
      companyPhone: '021-5550300',
      adminPublicId: MARKER_MAJU_BERSAMA,
      surveyStatus: 'VERIFIED',
      verifiedAt: now,
    })
    .returning();

  const [adminUser] = await db
    .insert(users)
    .values({
      publicLoginId: MARKER_MAJU_BERSAMA,
      email: 'admin.majubersama@workrecord.local',
      emailVerifiedAt: now,
      passwordHash,
      fullName: 'Admin Maju Bersama',
      accountType: 'ADMIN',
      roleId: adminRoleId,
      companyId: company.id,
    })
    .returning();

  const [payment] = await db
    .insert(payments)
    .values({
      userId: adminUser.id,
      companyId: company.id,
      type: 'SUBSCRIPTION',
      status: 'PAID',
      amount: '500000.00',
      gateway: 'mock',
      gatewayOrderId: `SUB-DUMMY-${company.id.slice(0, 8)}`,
      paidAt: now,
      metadata: { months: 3 },
    })
    .returning();

  await db.insert(subscriptions).values({
    userId: adminUser.id,
    companyId: company.id,
    status: 'ACTIVE',
    startsAt: now,
    endsAt: subEnds,
    paymentId: payment.id,
  });

  return company;
}

async function ensureVerifiedCompanyDocs(
  db: ReturnType<typeof drizzle<typeof schema>>,
  companyId: string,
) {
  await db
    .update(companies)
    .set({
      operationalStatus: 'ACTIVE',
      surveyStatus: 'VERIFIED',
      verifiedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(companies.id, companyId));

  for (const type of ['NIB', 'KTP_PENANGGUNG_JAWAB', 'AKTA'] as const) {
    const existing = await db.query.companyDocuments.findFirst({
      where: and(
        eq(companyDocuments.companyId, companyId),
        eq(companyDocuments.type, type),
      ),
    });
    if (!existing) {
      await db.insert(companyDocuments).values({
        companyId,
        type,
        status: 'APPROVED',
        filePath: `/seed/${type}.pdf`,
        uploadedAt: new Date(),
        reviewedAt: new Date(),
      });
    } else {
      await db
        .update(companyDocuments)
        .set({
          status: 'APPROVED',
          filePath: existing.filePath ?? `/seed/${type}.pdf`,
          uploadedAt: existing.uploadedAt ?? new Date(),
          reviewedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(companyDocuments.id, existing.id));
    }
  }
}

async function ensureDewiDispute(
  db: ReturnType<typeof drizzle<typeof schema>>,
  companyId: string,
) {
  const dewi = await db.query.employeeRecords.findFirst({
    where: and(
      eq(employeeRecords.companyId, companyId),
      eq(employeeRecords.employeeIdNumber, 'EMP-002'),
    ),
  });
  if (!dewi) return;
  const existing = await db.query.disputes.findFirst({
    where: eq(disputes.employeeRecordId, dewi.id),
  });
  if (!existing) {
    await db.insert(disputes).values({
      companyId,
      employeeRecordId: dewi.id,
      reporterEmail: 'dewi.lestari@example.local',
      description: 'Sanggahan atas catatan keterlambatan pada record.',
      status: 'INVESTIGATING',
    });
  }
}

async function syncDummyUpgrade(
  db: ReturnType<typeof drizzle<typeof schema>>,
  adminRoleId: string,
) {
  const profileIds = await upsertProfiles(db);
  const companyContoh = await db.query.companies.findFirst({
    where: eq(companies.adminPublicId, MARKER_ADMIN_ID),
  });
  if (!companyContoh) return;

  const companyBlur = await db.query.companies.findFirst({
    where: eq(companies.adminPublicId, 'ADM-DUMMYBLUR'),
  });
  const companyMaju = await ensureMajuBersamaCompany(db, adminRoleId);

  await ensureCompanyEmployees(db, companyContoh.id, profileIds);
  if (companyBlur) {
    await ensureSitiShowcase(
      db,
      profileIds,
      companyMaju.id,
      companyContoh.id,
      companyBlur.id,
    );
  }
  await ensureDewiDispute(db, companyContoh.id);
}

async function main() {
  const pool = new Pool({ connectionString: resolveDatabaseUrl() });
  const db = drizzle(pool, { schema });

  const { adminRoleId, leaderRoleId } = await seedSystem(db);

  const exists = await db.query.companies.findFirst({
    where: eq(companies.adminPublicId, MARKER_ADMIN_ID),
  });
  if (exists) {
    const profileIds = await upsertProfiles(db);
    const added = await ensureCompanyEmployees(db, exists.id, profileIds);
    await ensureVerifiedCompanyDocs(db, exists.id);
    await syncDummyUpgrade(db, adminRoleId);
    console.log(
      `PT dummy sudah ada. Record baru: ${added}. Profil & showcase Siti Aminah disinkronkan.`,
    );
    console.log('  companyId:', exists.id);
    console.log('  Contoh profil: Siti Aminah — WR-00001245 (3 perusahaan)');
    await pool.end();
    return;
  }

  const passwordHash = await bcrypt.hash(DUMMY_PASSWORD, 12);
  const now = new Date();
  const subEnds = new Date(now);
  subEnds.setMonth(subEnds.getMonth() + 3);

  const leaderPublicId = 'LDR-DUMMYMAJU';
  const profileIds = await upsertProfiles(db);

  const [company] = await db
    .insert(companies)
    .values({
      name: 'PT Contoh Maju (Dummy)',
      companyPhone: '021-5550100',
      adminPublicId: MARKER_ADMIN_ID,
      leaderPublicId,
      leadershipInvitedAt: now,
      surveyStatus: 'VERIFIED',
      verifiedAt: now,
      operationalStatus: 'ACTIVE',
    })
    .returning();

  await ensureVerifiedCompanyDocs(db, company.id);

  const [adminUser] = await db
    .insert(users)
    .values({
      publicLoginId: MARKER_ADMIN_ID,
      email: 'admin.dummy@workrecord.local',
      emailVerifiedAt: now,
      passwordHash,
      fullName: 'Budi Admin Dummy',
      personalPhone: '081234560001',
      accountType: 'ADMIN',
      roleId: adminRoleId,
      companyId: company.id,
    })
    .returning();

  await db.insert(users).values({
    publicLoginId: leaderPublicId,
    email: 'pimpinan.dummy@workrecord.local',
    emailVerifiedAt: now,
    passwordHash,
    fullName: 'Siti Pimpinan Dummy',
    personalPhone: '081234560002',
    accountType: 'LEADERSHIP',
    roleId: leaderRoleId,
    companyId: company.id,
  });

  const [payment] = await db
    .insert(payments)
    .values({
      userId: adminUser.id,
      companyId: company.id,
      type: 'SUBSCRIPTION',
      status: 'PAID',
      amount: '500000.00',
      gateway: 'mock',
      gatewayOrderId: `SUB-DUMMY-${company.id.slice(0, 8)}`,
      paidAt: now,
      metadata: { months: 3 },
    })
    .returning();

  await db.insert(subscriptions).values({
    userId: adminUser.id,
    companyId: company.id,
    status: 'ACTIVE',
    startsAt: now,
    endsAt: subEnds,
    paymentId: payment.id,
  });

  for (const row of fullDummyRows(company.id)) {
    await db.insert(employeeRecords).values({
      companyId: row.companyId,
      employeeProfileId: profileIds.get(row.profileKey),
      employeeName: row.employeeName,
      employeeIdNumber: row.employeeCode,
      position: row.position,
      joinedAt: row.joinedAt,
      leftAt: row.leftAt,
      conductSummary: row.conductSummary,
      violationNotes: row.violationNotes ?? null,
      isPublicPreview: row.isPublicPreview,
    });
  }

  const [company2] = await db
    .insert(companies)
    .values({
      name: 'PT Preview Blur (Dummy)',
      companyPhone: '021-5550200',
      adminPublicId: 'ADM-DUMMYBLUR',
      surveyStatus: 'PENDING',
    })
    .returning();

  await db.insert(employeeRecords).values({
    companyId: company2.id,
    employeeName: 'Karyawan Contoh Blur',
    position: 'Staff',
    joinedAt: new Date('2024-01-01'),
    conductSummary: 'Hanya terlihat blur tanpa bayar/login.',
    isPublicPreview: true,
  });

  const companyMaju = await ensureMajuBersamaCompany(db, adminRoleId);
  await ensureSitiShowcase(
    db,
    profileIds,
    companyMaju.id,
    company.id,
    company2.id,
  );
  await ensureDewiDispute(db, company.id);

  console.log('\n=== Data dummy WorkRecord ===\n');
  console.log('Password semua akun dummy:', DUMMY_PASSWORD);
  console.log('\nPT Contoh Maju (langganan AKTIF):');
  console.log('  companyId:', company.id);
  console.log('  Admin  — login:', MARKER_ADMIN_ID, '| email: admin.dummy@workrecord.local');
  console.log('  Pimpinan — login:', leaderPublicId, '| email: pimpinan.dummy@workrecord.local');
  console.log('  10 record karyawan + profil WR-00001001 … WR-00001010');
  console.log('\nPT Maju Bersama Indonesia (showcase Siti Aminah):');
  console.log('  companyId:', companyMaju.id);
  console.log('  Siti Aminah — WR-00001245, 3 riwayat perusahaan, 1 sanggahan OPEN');
  console.log('\nPT Preview Blur (tanpa langganan):');
  console.log('  companyId:', company2.id);
  console.log('  1 record blur publik\n');

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
