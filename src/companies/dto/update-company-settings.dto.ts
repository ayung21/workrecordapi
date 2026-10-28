import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateCompanySettingsDto {
  @IsOptional()
  @IsString()
  @MaxLength(200, { message: 'Bidang usaha maksimal 200 karakter' })
  businessField?: string;
}
