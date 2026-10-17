import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';

/** Batasi handler ke salah satu roleCode JWT (contoh: OWNER). */
export const RequireRoles = (...roles: string[]) =>
  SetMetadata(ROLES_KEY, roles);
