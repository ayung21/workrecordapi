import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

/** Nomor hotline tampil di website & portal PT (disimpan di DB). */
export class UpdateSupportHotlineDto {
  @IsString()
  @MinLength(8)
  @MaxLength(24)
  @Matches(/^[\d\s+()-]+$/, {
    message: 'Nomor hanya boleh angka, spasi, +, -, dan tanda kurung',
  })
  phone!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  label?: string;
}
