import { IsString, MinLength } from 'class-validator';

export class ForgotPasswordDto {
  /** ID login atau email (sama seperti form login). */
  @IsString()
  @MinLength(3)
  login: string;
}
