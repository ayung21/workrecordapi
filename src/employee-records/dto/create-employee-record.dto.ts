import {
  IsDateString,
  IsOptional,
  IsString,
  Matches,
  MinLength,
} from 'class-validator';

export class CreateEmployeeRecordDto {
  /** NIK KTP (16 digit), bukan nomor ID karyawan internal. */
  @IsString()
  @Matches(/^\d{16}$/, {
    message: 'NIK KTP harus 16 digit angka',
  })
  nationalIdNumber: string;

  /** Nomor/ kode ID karyawan di perusahaan (opsional, bukan NIK KTP). */
  @IsOptional()
  @IsString()
  @MinLength(1)
  employeeCode?: string;

  @IsString()
  @MinLength(2)
  employeeName: string;

  @IsString()
  @MinLength(2)
  placeOfBirth: string;

  @IsDateString()
  dateOfBirth: string;

  @IsDateString()
  joinedAt: string;

  @IsOptional()
  @IsDateString()
  leftAt?: string;

  @IsString()
  @MinLength(2)
  position: string;

  @IsOptional()
  @IsString()
  conductSummary?: string;
}
