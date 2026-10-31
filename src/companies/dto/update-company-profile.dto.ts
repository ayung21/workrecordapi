import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** Profil perusahaan — diubah Owner WorkRecord (admin panel). */
export class UpdateCompanyProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200, { message: 'Bidang usaha maksimal 200 karakter' })
  businessField?: string;
}
