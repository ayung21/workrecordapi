import {
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';

export class BlacklistCheckoutDto {
  @IsUUID()
  employeeRecordId: string;

  @IsString()
  @MinLength(10)
  note: string;

  @IsEmail()
  email: string;

  @IsOptional()
  @IsString()
  voucherCode?: string;

  @IsOptional()
  @IsUUID()
  manualBankAccountId?: string;
}
