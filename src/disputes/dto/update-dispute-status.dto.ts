import { DisputeStatus, disputeStatuses } from '../../database/enums';
import { IsIn, IsOptional, IsString } from 'class-validator';

export class UpdateDisputeStatusDto {
  @IsIn([...disputeStatuses])
  status: DisputeStatus;

  @IsOptional()
  @IsString()
  resolutionNotes?: string;
}
