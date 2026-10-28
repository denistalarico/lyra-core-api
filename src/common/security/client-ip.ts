import type { Request } from 'express';

/**
 * The client IP as observed by our nginx (SEC-02). Relies on `main.ts`
 * trusting only loopback proxies: `req.ip` is then the right-most
 * `X-Forwarded-For` entry appended by nginx (`$proxy_add_x_forwarded_for`),
 * so a client-supplied `X-Forwarded-For` prefix is ignored, and a direct
 * non-loopback connection is keyed by its socket address.
 */
export function resolveClientIp(req: Request): string {
  return (req.ip || req.socket?.remoteAddress || 'unknown').replace(
    /^::ffff:/,
    '',
  );
}
