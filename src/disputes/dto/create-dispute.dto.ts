import { IsEmail, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class CreateDisputeDto {
  @IsUUID()
  companyId: string;

  @IsOptional()
  @IsUUID()
  employeeRecordId?: string;

  @IsEmail()
  reporterEmail: string;

  @IsString()
  @MinLength(20)
  description: string;

  @IsUUID()
  paymentId: string;
}
