import { Transform } from 'class-transformer';
import { IsDateString, IsOptional, IsString, IsUrl, ValidateIf } from 'class-validator';

function normalizeMeetingUrl(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const t = String(value).trim();
  if (!t) return undefined;
  if (/^https?:\/\//i.test(t)) return t;
  return `https://${t}`;
}

export class ScheduleSiteVerificationDto {
  @IsDateString()
  scheduledAt!: string;

  @Transform(({ value }) => normalizeMeetingUrl(value))
  @ValidateIf((o) => o.meetingUrl !== undefined && o.meetingUrl !== '')
  @IsUrl({ require_protocol: true })
  @IsOptional()
  meetingUrl?: string;

  @IsOptional()
  @IsString()
  adminNotes?: string;
}
