import { IsEmail, IsIn, IsString, MinLength } from 'class-validator';

export const PARTNER_RELATION_ROLES = ['ATASAN', 'BAWAHAN'] as const;
export type PartnerRelationRole = (typeof PARTNER_RELATION_ROLES)[number];

export class PartnerAccountDto {
  @IsString()
  @MinLength(2)
  fullName: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  personalPhone: string;

  /** Peran akun kedua; peran akun pembayar ditentukan otomatis (kebalikan). */
  @IsIn(PARTNER_RELATION_ROLES)
  relationRole: PartnerRelationRole;
}
