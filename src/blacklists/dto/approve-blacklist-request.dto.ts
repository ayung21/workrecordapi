import { IsEmail, IsOptional, IsString } from 'class-validator';

export class ApproveBlacklistRequestDto {
  @IsEmail()
  email: string;

  @IsOptional()
  @IsString()
  voucherCode?: string;
}
