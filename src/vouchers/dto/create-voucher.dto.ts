import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import {
  voucherAppliesTo,
  voucherBenefitTypes,
  voucherEligibilityModes,
} from '../../database/enums';

export class CreateVoucherDto {
  @IsString()
  @MinLength(3)
  code: string;

  @IsString()
  @MinLength(3)
  title: string;

  @IsIn([...voucherAppliesTo])
  appliesTo: (typeof voucherAppliesTo)[number];

  @IsIn([...voucherBenefitTypes])
  benefitType: (typeof voucherBenefitTypes)[number];

  @IsNumber()
  @Min(0)
  benefitValue: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxUses?: number;

  /** Kuota pemakaian per perusahaan (mode ALL). */
  @IsOptional()
  @IsInt()
  @Min(1)
  maxUsesPerCompany?: number;

  @IsOptional()
  @IsIn([...voucherEligibilityModes])
  eligibilityMode?: (typeof voucherEligibilityModes)[number];

  @ValidateIf((o) => o.eligibilityMode === 'SELECTED')
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  companyIds?: string[];

  @IsOptional()
  @IsString()
  expiresAt?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
