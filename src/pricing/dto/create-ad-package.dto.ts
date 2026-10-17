import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';
import { adPlacementSlots } from '../../database/enums';

export class CreateAdPackageDto {
  @IsString()
  @MinLength(2)
  code: string;

  @IsString()
  @MinLength(2)
  label: string;

  @IsIn([...adPlacementSlots])
  placement: (typeof adPlacementSlots)[number];

  @IsInt()
  @Min(1)
  durationDays: number;

  @IsNumber()
  @Min(0)
  priceIdr: number;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  validFrom?: string;

  @IsOptional()
  @IsString()
  validUntil?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}
