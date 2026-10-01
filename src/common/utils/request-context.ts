import { Request } from 'express';

export function extractRequestMeta(req?: Request): {
  ipAddress?: string;
  userAgent?: string;
} {
  if (!req) return {};
  const forwarded = req.headers['x-forwarded-for'];
  const ip =
    typeof forwarded === 'string'
      ? forwarded.split(',')[0].trim()
      : req.socket.remoteAddress;
  const ua = req.headers['user-agent'];
  return {
    ipAddress: ip,
    userAgent: typeof ua === 'string' ? ua : undefined,
  };
}
