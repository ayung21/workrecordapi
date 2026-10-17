/** Platform super-admin (Owner). Bisa login di admin panel dan frontend utama. */
export const PLATFORM_OWNER_ROLE = 'OWNER' as const;

/** Role perusahaan — hanya frontend utama, tidak boleh login panel admin. */
export const COMPANY_PORTAL_ROLES = [
  'COMPANY_ADMIN',
  'COMPANY_LEADERSHIP',
] as const;

export type CompanyPortalRole = (typeof COMPANY_PORTAL_ROLES)[number];

export function isPlatformOwner(roleCode: string): boolean {
  return roleCode === PLATFORM_OWNER_ROLE;
}

export function isCompanyPortalRole(roleCode: string): boolean {
  return (COMPANY_PORTAL_ROLES as readonly string[]).includes(roleCode);
}
