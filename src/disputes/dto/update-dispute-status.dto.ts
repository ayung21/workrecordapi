import { DisputeStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';

export class UpdateDisputeStatusDto {
  @IsEnum(DisputeStatus)
  status: DisputeStatus;

  @IsOptional()
  @IsString()
  resolutionNotes?: string;
}
