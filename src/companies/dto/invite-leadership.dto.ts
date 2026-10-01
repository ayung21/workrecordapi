import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class InviteLeadershipDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(2)
  fullName: string;

  @IsOptional()
  @IsString()
  personalPhone?: string;
}
