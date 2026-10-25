import { BadRequestException } from '@nestjs/common';

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})/;

/**
 * Parse tanggal kalender YYYY-MM-DD (awal string boleh diikuti waktu ISO).
 * Menghindari `new Date(string)` pada input aneh dari multipart form.
 */
export function parseDateOnlyField(
  raw: string,
  fieldLabel: string,
): Date {
  const trimmed = raw?.trim();
  if (!trimmed) {
    throw new BadRequestException(`${fieldLabel} wajib diisi (format YYYY-MM-DD)`);
  }
  const match = DATE_ONLY.exec(trimmed);
  if (!match) {
    throw new BadRequestException(
      `${fieldLabel} tidak valid. Gunakan format YYYY-MM-DD.`,
    );
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new BadRequestException(`${fieldLabel} tidak valid`);
  }
  return date;
}

export function parseOptionalDateOnlyField(
  raw: string | undefined,
  fieldLabel: string,
): Date | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  return parseDateOnlyField(trimmed, fieldLabel);
}
