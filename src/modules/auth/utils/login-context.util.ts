import { createHash } from 'crypto';
import type { Request } from 'express';

export type LoginRequestContext = {
  ipAddress: string;
  userAgent: string;
  acceptLanguage: string;
  deviceFingerprint: string;
  deviceName: string;
  location: string | null;
};

export function extractLoginContext(req: Request): LoginRequestContext {
  const userAgent = truncateMetadata(
    getSingleHeaderValue(req.headers['user-agent']) ?? 'Unknown',
  );
  const acceptLanguage = truncateMetadata(
    getSingleHeaderValue(req.headers['accept-language']) ?? '',
  );
  const ipAddress = truncateMetadata(getRequestIpAddress(req));

  return {
    ipAddress,
    userAgent,
    acceptLanguage,
    deviceFingerprint: createHash('sha256')
      .update([userAgent, acceptLanguage].join('|'))
      .digest('hex'),
    deviceName: getDeviceName(userAgent),
    location: null,
  };
}

function getRequestIpAddress(req: Request): string {
  const forwardedFor = getSingleHeaderValue(req.headers['x-forwarded-for']);
  const realIp = getSingleHeaderValue(req.headers['x-real-ip']);
  const ip =
    forwardedFor?.split(',')[0]?.trim() ??
    realIp?.trim() ??
    req.ip ??
    req.socket.remoteAddress ??
    'Unknown';

  return ip.replace(/^::ffff:/, '');
}

function getSingleHeaderValue(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function getDeviceName(userAgent: string): string {
  const browser = getBrowserName(userAgent);
  const os = getOperatingSystemName(userAgent);

  if (browser === 'Unknown' && os === 'Unknown') {
    return 'Dispositivo desconhecido';
  }

  if (browser === 'Unknown') {
    return os;
  }

  if (os === 'Unknown') {
    return browser;
  }

  return `${browser} · ${os}`;
}

function getBrowserName(userAgent: string): string {
  if (/Edg\//i.test(userAgent)) return 'Edge';
  if (/OPR\//i.test(userAgent)) return 'Opera';
  if (/Firefox\//i.test(userAgent)) return 'Firefox';
  if (/SamsungBrowser\//i.test(userAgent)) return 'Samsung Internet';
  if (/Chrome\//i.test(userAgent) || /CriOS\//i.test(userAgent)) {
    return 'Chrome';
  }
  if (/Safari\//i.test(userAgent)) return 'Safari';

  return 'Unknown';
}

function getOperatingSystemName(userAgent: string): string {
  if (/Windows NT/i.test(userAgent)) return 'Windows';
  if (/Android/i.test(userAgent)) return 'Android';
  if (/(iPhone|iPad|iPod)/i.test(userAgent)) return 'iOS';
  if (/Mac OS X/i.test(userAgent)) return 'macOS';
  if (/Linux/i.test(userAgent)) return 'Linux';

  return 'Unknown';
}

function truncateMetadata(value: string): string {
  return value.slice(0, 120);
}
