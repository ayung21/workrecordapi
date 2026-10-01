import { ViewDurationUnit } from '@prisma/client';
import {
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsUUID,
  Min,
} from 'class-validator';

export class CreateViewAccessDto {
  @IsEmail()
  email: string;

  @IsUUID()
  companyId: string;

  @IsOptional()
  @IsUUID()
  employeeRecordId?: string;

  @IsEnum(ViewDurationUnit)
  durationUnit: ViewDurationUnit;

  @IsInt()
  @Min(1)
  durationValue: number;

  @IsOptional()
  @IsUUID()
  userId?: string;
}
