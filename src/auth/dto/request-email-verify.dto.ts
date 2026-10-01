import { IsEmail, IsOptional } from 'class-validator';

export class RequestEmailVerifyDto {
  @IsOptional()
  @IsEmail()
  newEmail?: string;
}
