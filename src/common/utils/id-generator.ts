import { randomBytes } from 'crypto';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Generates a unique public ID prefix PT + 10 chars, globally unique via DB constraint */
export function generatePublicLoginId(prefix: 'ADM' | 'LDR' | 'USR'): string {
  const bytes = randomBytes(8);
  let body = '';
  for (let i = 0; i < 10; i++) {
    body += ALPHABET[bytes[i % bytes.length] % ALPHABET.length];
  }
  return `${prefix}-${body}`;
}

export function generateSecureToken(): string {
  return randomBytes(32).toString('hex');
}
