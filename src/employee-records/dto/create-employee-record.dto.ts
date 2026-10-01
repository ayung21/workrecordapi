import { IsDateString, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateEmployeeRecordDto {
  @IsString()
  @MinLength(2)
  employeeName: string;

  @IsOptional()
  @IsString()
  employeeIdNumber?: string;

  @IsOptional()
  @IsString()
  position?: string;

  @IsOptional()
  @IsDateString()
  joinedAt?: string;

  @IsOptional()
  @IsDateString()
  leftAt?: string;

  @IsOptional()
  @IsString()
  conductSummary?: string;

  @IsOptional()
  @IsString()
  violationNotes?: string;
}
