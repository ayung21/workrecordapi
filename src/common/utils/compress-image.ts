import { BadRequestException } from '@nestjs/common';
import sharp from 'sharp';

const ALLOWED_INPUT = ['image/jpeg', 'image/png', 'image/webp'] as const;

export type CompressImageOptions = {
  /** Lebar/tinggi maksimum (px); gambar tidak diperbesar. */
  maxEdge: number;
  /** Kualitas WebP 1–100 */
  quality?: number;
};

export type CompressedImage = {
  buffer: Buffer;
  mimetype: 'image/webp';
  extension: 'webp';
};

/**
 * Kompres & resize upload gambar ke WebP agar hemat penyimpanan di server.
 */
export async function compressUploadedImage(
  file: { buffer: Buffer; mimetype: string },
  options: CompressImageOptions,
): Promise<CompressedImage> {
  if (!file.buffer?.length) {
    throw new BadRequestException('File gambar kosong');
  }
  if (!ALLOWED_INPUT.includes(file.mimetype as (typeof ALLOWED_INPUT)[number])) {
    throw new BadRequestException('Gambar harus JPG, PNG, atau WEBP');
  }

  const quality = options.quality ?? 82;

  let pipeline = sharp(file.buffer, { failOn: 'none' }).rotate();

  const meta = await pipeline.metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (w > options.maxEdge || h > options.maxEdge) {
    pipeline = pipeline.resize({
      width: w >= h ? options.maxEdge : undefined,
      height: h > w ? options.maxEdge : undefined,
      fit: 'inside',
      withoutEnlargement: true,
    });
  }

  const buffer = await pipeline.webp({ quality, effort: 4 }).toBuffer();

  return {
    buffer,
    mimetype: 'image/webp',
    extension: 'webp',
  };
}
