import { BadRequestException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { DatabaseService } from '../database/database.service';
import { payments } from '../database/schema';

export type ManualPaymentMetadata = {
  baseAmount?: number;
  uniqueCode?: number;
  manualTransfer?: boolean;
};

export function parseUniqueCodeFromMetadata(
  metadata: unknown,
): number | undefined {
  if (!metadata || typeof metadata !== 'object') return undefined;
  const code = (metadata as ManualPaymentMetadata).uniqueCode;
  return typeof code === 'number' && code >= 1 && code <= 999
    ? code
    : undefined;
}

export async function allocateManualUniqueCode(
  database: DatabaseService,
): Promise<number> {
  const db = database.db;
  const pending = await db
    .select({ metadata: payments.metadata })
    .from(payments)
    .where(
      and(eq(payments.status, 'PENDING'), eq(payments.gateway, 'manual')),
    );

  const used = new Set<number>();
  for (const row of pending) {
    const code = parseUniqueCodeFromMetadata(row.metadata);
    if (code) used.add(code);
  }

  const available: number[] = [];
  for (let n = 1; n <= 999; n++) {
    if (!used.has(n)) available.push(n);
  }
  if (available.length === 0) {
    throw new BadRequestException(
      'Kode unik transfer habis (999 pembayaran manual tertunda). Konfirmasi atau batalkan yang lama.',
    );
  }
  const pick = available[Math.floor(Math.random() * available.length)];
  return pick;
}

export function transferAmountIdr(baseAmount: number, uniqueCode: number): number {
  return Math.round(baseAmount) + uniqueCode;
}
