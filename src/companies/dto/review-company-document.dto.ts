import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class ReviewCompanyDocumentDto {
  @IsBoolean()
  approve: boolean;

  @IsOptional()
  @IsString()
  rejectReason?: string;
}
