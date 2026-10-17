import { IsString, MinLength } from 'class-validator';

export class RejectChangeRequestDto {
  @IsString()
  @MinLength(5, {
    message: 'Alasan penolakan wajib diisi (min. 5 karakter)',
  })
  rejectionReason: string;
}
