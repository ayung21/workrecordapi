import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MinLength,
} from 'class-validator';
import { voucherAppliesTo } from '../../database/enums';

export class QuoteVoucherDto {
  @IsString()
  @MinLength(3)
  code: string;

  @IsIn([...voucherAppliesTo])
  appliesTo: (typeof voucherAppliesTo)[number];

  @IsNumber()
  @Min(0)
  amount: number;

  /** Wajib untuk voucher perusahaan tertentu / kuota per PT. */
  @IsOptional()
  @IsUUID()
  companyId?: string;
}
