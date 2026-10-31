import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

/** Pengaturan portal — hanya Pimpinan (Master): akun Admin PT & telepon perusahaan. */
export class UpdateCompanySettingsDto {
  @IsOptional()
  @IsEmail({}, { message: 'Format email admin tidak valid' })
  adminEmail?: string;

  @IsOptional()
  @IsString()
  @MinLength(8, { message: 'Telepon perusahaan minimal 8 karakter' })
  companyPhone?: string;
}
