import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RequestDocumentReuploadDto {
  /** Catatan untuk PT (tampil di portal verifikasi). */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
