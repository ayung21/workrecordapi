import { IsEmail, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateDisputeCheckoutDto {
  @IsEmail()
  email: string;

  @IsOptional()
  @IsUUID()
  employeeRecordId?: string;

  @IsOptional()
  @IsString()
  voucherCode?: string;
}
