import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
  ValidateNested,
} from 'class-validator';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeOptionalUuid(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const v = String(value).trim();
  if (!v) return undefined;
  return UUID_RE.test(v) ? v : undefined;
}

export class ManualPaymentBankAccountDto {
  @Transform(({ value }) => normalizeOptionalUuid(value))
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  label?: string;

  @IsString()
  @MinLength(2)
  bankName!: string;

  @IsString()
  @MinLength(5)
  accountNumber!: string;

  @IsString()
  @MinLength(2)
  accountHolder!: string;
}

export class UpdateManualPaymentBankDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ManualPaymentBankAccountDto)
  accounts!: ManualPaymentBankAccountDto[];
}
