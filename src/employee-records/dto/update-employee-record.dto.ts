import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsOptional,
  IsString,
  Matches,
  MinLength,
  ValidateIf,
} from 'class-validator';

function trimOptionalDate(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') return value as string;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

/** Kosong / null = hapus tanggal selesai kerja di database. */
function trimOptionalLeftAt(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (value === undefined) return undefined;
  if (typeof value !== 'string') return value as string;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

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
  @Transform(({ value }) => trimOptionalDate(value))
  @ValidateIf((_, v) => v !== undefined)
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
  @Transform(({ value }) => trimOptionalDate(value))
  @ValidateIf((_, v) => v !== undefined)
  @IsDateString()
  joinedAt?: string;

  @IsOptional()
  @Transform(({ value }) => trimOptionalLeftAt(value))
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsDateString()
  leftAt?: string | null;

  @IsOptional()
  @IsString()
  conductSummary?: string;

  @IsOptional()
  @IsString()
  violationNotes?: string;
}
