import { ViewDurationUnit, viewDurationUnits } from '../../database/enums';
import {
  IsEmail,
  IsIn,
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

  @IsIn([...viewDurationUnits])
  durationUnit: ViewDurationUnit;

  @IsInt()
  @Min(1)
  durationValue: number;

  @IsOptional()
  @IsUUID()
  userId?: string;
}
