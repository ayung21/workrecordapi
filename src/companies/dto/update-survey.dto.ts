import { IsIn, IsOptional, IsString } from 'class-validator';

export class UpdateSurveyDto {
  @IsIn(['VERIFIED', 'REJECTED'])
  status: 'VERIFIED' | 'REJECTED';

  @IsOptional()
  @IsString()
  notes?: string;
}
