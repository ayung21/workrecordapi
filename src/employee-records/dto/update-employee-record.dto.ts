import {
  IsDateString,
  IsOptional,
  IsString,
  Matches,
  MinLength,
} from 'class-validator';

export class UpdateEmployeeRecordDto {
  @IsOptional()
  @IsString()
  @Matches(/^\d{16}$/, {
    message: 'NIK KTP harus 16 digit angka',
  })
  nationalIdNumber?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  placeOfBirth?: string;

  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  employeeName?: string;

  /** Nomor/ kode ID karyawan internal (bukan NIK KTP). */
  @IsOptional()
  @IsString()
  employeeIdNumber?: string;

  @IsOptional()
  @IsString()
  position?: string;

  @IsOptional()
  @IsDateString()
  joinedAt?: string;

  @IsOptional()
  @IsDateString()
  leftAt?: string;

  @IsOptional()
  @IsString()
  conductSummary?: string;

  @IsOptional()
  @IsString()
  violationNotes?: string;
}
