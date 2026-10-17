import { IsString, Matches, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @IsString()
  @MinLength(3)
  login: string;

  @IsString()
  @Matches(/^\d{6}$/, { message: 'OTP harus 6 digit angka' })
  otp: string;

  @IsString()
  @MinLength(8)
  newPassword: string;
}
