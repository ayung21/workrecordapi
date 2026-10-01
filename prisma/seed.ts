import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { generatePublicLoginId } from '../src/common/utils/id-generator';

const prisma = new PrismaClient();

const PERMISSIONS = [
  { code: 'companies.manage_all', name: 'Kelola semua PT' },
  { code: 'companies.survey', name: 'Survey & verifikasi PT' },
  { code: 'records.crud', name: 'CRUD record karyawan' },
  { code: 'records.approve', name: 'Approve perubahan record' },
  { code: 'disputes.manage', name: 'Kelola pengaduan' },
  { code: 'subscriptions.manage', name: 'Kelola langganan' },
];

async function main() {
  for (const p of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { code: p.code },
      create: p,
      update: { name: p.name },
    });
  }

  const ownerGroup = await prisma.roleGroup.upsert({
    where: { code: 'PLATFORM' },
    create: {
      code: 'PLATFORM',
      name: 'Platform',
      isSystem: true,
    },
    update: {},
  });

  const companyGroup = await prisma.roleGroup.upsert({
    where: { code: 'COMPANY' },
    create: {
      code: 'COMPANY',
      name: 'Perusahaan',
      isSystem: true,
    },
    update: {},
  });

  const ownerRole = await prisma.role.upsert({
    where: { code: 'OWNER' },
    create: {
      code: 'OWNER',
      name: 'Owner',
      roleGroupId: ownerGroup.id,
      isSystem: true,
    },
    update: {},
  });

  const adminRole = await prisma.role.upsert({
    where: { code: 'COMPANY_ADMIN' },
    create: {
      code: 'COMPANY_ADMIN',
      name: 'Admin PT',
      roleGroupId: companyGroup.id,
      isSystem: true,
    },
    update: {},
  });

  const leaderRole = await prisma.role.upsert({
    where: { code: 'COMPANY_LEADERSHIP' },
    create: {
      code: 'COMPANY_LEADERSHIP',
      name: 'Pimpinan PT',
      roleGroupId: companyGroup.id,
      isSystem: true,
    },
    update: {},
  });

  const allPerms = await prisma.permission.findMany();
  for (const perm of allPerms) {
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: ownerRole.id, permissionId: perm.id } },
      create: { roleId: ownerRole.id, permissionId: perm.id },
      update: {},
    });
  }

  const companyPerms = ['records.crud', 'records.approve'];
  for (const code of companyPerms) {
    const perm = await prisma.permission.findUniqueOrThrow({ where: { code } });
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: { roleId: adminRole.id, permissionId: perm.id },
      },
      create: { roleId: adminRole.id, permissionId: perm.id },
      update: {},
    });
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: { roleId: leaderRole.id, permissionId: perm.id },
      },
      create: { roleId: leaderRole.id, permissionId: perm.id },
      update: {},
    });
  }

  const ownerEmail = process.env.SEED_OWNER_EMAIL ?? 'owner@workrecord.local';
  const ownerPass = process.env.SEED_OWNER_PASSWORD ?? 'OwnerPass123!';
  const existing = await prisma.user.findUnique({ where: { email: ownerEmail } });
  if (!existing) {
    await prisma.user.create({
      data: {
        publicLoginId: generatePublicLoginId('USR'),
        email: ownerEmail,
        emailVerifiedAt: new Date(),
        passwordHash: await bcrypt.hash(ownerPass, 12),
        fullName: 'Platform Owner',
        accountType: 'MEMBER',
        roleId: ownerRole.id,
      },
    });
    console.log(`Owner created: ${ownerEmail} / ${ownerPass}`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
