import { IsEmail, IsString, MinLength } from 'class-validator';

export class RegisterCompanyDto {
  @IsString()
  @MinLength(2)
  companyName: string;

  @IsString()
  @MinLength(8)
  companyPhone: string;

  @IsString()
  @MinLength(2)
  fullName: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsString()
  personalPhone: string;
}
