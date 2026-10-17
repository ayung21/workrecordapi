import { eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as bcrypt from 'bcrypt';
import { generatePublicLoginId } from '../src/common/utils/id-generator';
import {
  permissions,
  roleGroups,
  rolePermissions,
  roles,
  users,
} from '../src/database/schema';
import { schema } from '../src/database/schema';

const PERMISSIONS = [
  { code: 'companies.manage_all', name: 'Kelola semua PT' },
  { code: 'companies.survey', name: 'Survey & verifikasi PT' },
  { code: 'records.crud', name: 'CRUD record karyawan' },
  { code: 'records.approve', name: 'Approve perubahan record' },
  { code: 'disputes.manage', name: 'Kelola pengaduan' },
  { code: 'subscriptions.manage', name: 'Kelola langganan' },
];

export type SystemSeedResult = {
  ownerRoleId: string;
  adminRoleId: string;
  leaderRoleId: string;
};

export async function seedSystem(
  db: NodePgDatabase<typeof schema>,
): Promise<SystemSeedResult> {
  for (const p of PERMISSIONS) {
    await db
      .insert(permissions)
      .values(p)
      .onConflictDoUpdate({
        target: permissions.code,
        set: { name: p.name },
      });
  }

  const [ownerGroup] = await db
    .insert(roleGroups)
    .values({ code: 'PLATFORM', name: 'Platform', isSystem: true })
    .onConflictDoUpdate({
      target: roleGroups.code,
      set: { name: 'Platform' },
    })
    .returning();

  const [companyGroup] = await db
    .insert(roleGroups)
    .values({ code: 'COMPANY', name: 'Perusahaan', isSystem: true })
    .onConflictDoUpdate({
      target: roleGroups.code,
      set: { name: 'Perusahaan' },
    })
    .returning();

  const [ownerRole] = await db
    .insert(roles)
    .values({
      code: 'OWNER',
      name: 'Owner',
      roleGroupId: ownerGroup.id,
      isSystem: true,
    })
    .onConflictDoUpdate({
      target: roles.code,
      set: { name: 'Owner', roleGroupId: ownerGroup.id },
    })
    .returning();

  const [adminRole] = await db
    .insert(roles)
    .values({
      code: 'COMPANY_ADMIN',
      name: 'Admin PT',
      roleGroupId: companyGroup.id,
      isSystem: true,
    })
    .onConflictDoUpdate({
      target: roles.code,
      set: { name: 'Admin PT', roleGroupId: companyGroup.id },
    })
    .returning();

  const [leaderRole] = await db
    .insert(roles)
    .values({
      code: 'COMPANY_LEADERSHIP',
      name: 'Pimpinan PT',
      roleGroupId: companyGroup.id,
      isSystem: true,
    })
    .onConflictDoUpdate({
      target: roles.code,
      set: { name: 'Pimpinan PT', roleGroupId: companyGroup.id },
    })
    .returning();

  const allPerms = await db.select().from(permissions);
  for (const perm of allPerms) {
    await db
      .insert(rolePermissions)
      .values({ roleId: ownerRole.id, permissionId: perm.id })
      .onConflictDoNothing();
  }

  for (const code of ['records.crud', 'records.approve']) {
    const perm = allPerms.find((p) => p.code === code);
    if (!perm) continue;
    await db
      .insert(rolePermissions)
      .values({ roleId: adminRole.id, permissionId: perm.id })
      .onConflictDoNothing();
    await db
      .insert(rolePermissions)
      .values({ roleId: leaderRole.id, permissionId: perm.id })
      .onConflictDoNothing();
  }

  const ownerEmail = process.env.SEED_OWNER_EMAIL ?? 'owner@workrecord.local';
  const ownerPass = process.env.SEED_OWNER_PASSWORD ?? 'OwnerPass123!';
  const existingOwner = await db.query.users.findFirst({
    where: eq(users.email, ownerEmail),
  });
  if (!existingOwner) {
    await db.insert(users).values({
      publicLoginId: generatePublicLoginId('USR'),
      email: ownerEmail,
      emailVerifiedAt: new Date(),
      passwordHash: await bcrypt.hash(ownerPass, 12),
      fullName: 'Platform Owner',
      accountType: 'MEMBER',
      roleId: ownerRole.id,
    });
    console.log(`Owner: ${ownerEmail} / ${ownerPass}`);
  }

  return {
    ownerRoleId: ownerRole.id,
    adminRoleId: adminRole.id,
    leaderRoleId: leaderRole.id,
  };
}
