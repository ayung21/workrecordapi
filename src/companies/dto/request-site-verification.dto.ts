import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';

export class RequestSiteVerificationDto {
  @IsEnum(['VIDEO_CALL', 'ON_SITE'])
  method!: 'VIDEO_CALL' | 'ON_SITE';

  @IsString()
  @MinLength(2)
  contactName!: string;

  @IsString()
  @MinLength(8)
  contactPhone!: string;

  @IsString()
  @MinLength(10)
  address!: string;

  @IsOptional()
  @IsString()
  preferredScheduleNote?: string;
}
