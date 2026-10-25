import { IsEmail, IsOptional, IsString, IsUUID } from 'class-validator';

export class ApproveBlacklistRequestDto {
  @IsEmail()
  email: string;

  @IsOptional()
  @IsString()
  voucherCode?: string;

  @IsOptional()
  @IsUUID()
  manualBankAccountId?: string;
}
