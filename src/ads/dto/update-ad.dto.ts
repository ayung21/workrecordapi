import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Min,
  MinLength,
} from 'class-validator';
import { adPlacementSlots, adPlacementStatuses } from '../../database/enums';

export class UpdateAdDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  title?: string;

  @IsOptional()
  @IsString()
  subtitle?: string;

  @IsOptional()
  @IsString()
  ctaLabel?: string;

  @IsOptional()
  @IsUrl({ require_protocol: true })
  ctaUrl?: string;

  @IsOptional()
  @IsIn([...adPlacementStatuses])
  status?: (typeof adPlacementStatuses)[number];

  @IsOptional()
  @IsNumber()
  @Min(0)
  priceAmount?: number;

  @IsOptional()
  @IsString()
  startsAt?: string;

  @IsOptional()
  @IsString()
  endsAt?: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsIn([...adPlacementSlots])
  placement?: (typeof adPlacementSlots)[number];
}
