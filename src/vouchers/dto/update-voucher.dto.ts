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

export class UpdateVoucherDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  title?: string;

  @IsOptional()
  @IsIn([...voucherAppliesTo])
  appliesTo?: (typeof voucherAppliesTo)[number];

  @IsOptional()
  @IsIn([...voucherBenefitTypes])
  benefitType?: (typeof voucherBenefitTypes)[number];

  @IsOptional()
  @IsNumber()
  @Min(0)
  benefitValue?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxUses?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxUsesPerCompany?: number | null;

  @IsOptional()
  @IsIn([...voucherEligibilityModes])
  eligibilityMode?: (typeof voucherEligibilityModes)[number];

  @ValidateIf((o) => o.eligibilityMode === 'SELECTED')
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  companyIds?: string[];

  @IsOptional()
  @IsString()
  expiresAt?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
