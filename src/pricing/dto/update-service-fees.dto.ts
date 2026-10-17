import { IsInt, IsOptional, Min } from 'class-validator';

export class UpdateServiceFeesDto {
  /** Harga blacklist / sanggahan karyawan (satu tarif). */
  @IsOptional()
  @IsInt()
  @Min(0)
  sanggahanKaryawanIdr?: number;

  /** @deprecated — disamakan ke sanggahanKaryawanIdr */
  @IsOptional()
  @IsInt()
  @Min(0)
  disputeIdr?: number;

  /** @deprecated — disamakan ke sanggahanKaryawanIdr */
  @IsOptional()
  @IsInt()
  @Min(0)
  blacklistIdr?: number;

  /** Harga checkout iklan tanpa paket (banner company profile). */
  @IsOptional()
  @IsInt()
  @Min(0)
  adPlacementIdr?: number;
}
