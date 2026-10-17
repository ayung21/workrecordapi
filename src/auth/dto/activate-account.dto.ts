import { IsString, MinLength } from 'class-validator';

export class ActivateAccountDto {
  @IsString()
  @MinLength(20)
  token: string;

  @IsString()
  @MinLength(8)
  password: string;
}
