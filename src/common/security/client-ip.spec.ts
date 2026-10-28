import express from 'express';
import type { Request } from 'express';
import request from 'supertest';
import { resolveClientIp } from './client-ip';

/** Same setting as `main.ts`. */
function appTrustingLoopback() {
  const app = express();
  app.set('trust proxy', 'loopback');
  app.get('/ip', (req, res) => {
    res.json({ ip: resolveClientIp(req) });
  });
  return app;
}

describe('SEC-02 resolveClientIp behind nginx', () => {
  it('uses the address nginx appended, ignoring a forged left-most entry', async () => {
    // nginx: X-Forwarded-For = <client header>, $remote_addr
    const response = await request(appTrustingLoopback())
      .get('/ip')
      .set('X-Forwarded-For', '6.6.6.6, 203.0.113.9');

    expect(response.body).toEqual({ ip: '203.0.113.9' });
  });

  it('ignores X-Forwarded-For from a peer that is not the local proxy', () => {
    const app = appTrustingLoopback();
    const socket = { remoteAddress: '198.51.100.4' };
    const req = Object.create(app.request as object) as Request;
    Object.assign(req, {
      headers: { 'x-forwarded-for': '6.6.6.6' },
      socket,
      connection: socket,
    });

    expect(resolveClientIp(req)).toBe('198.51.100.4');
  });

  it('falls back to the socket and strips the IPv4-mapped prefix', () => {
    const req = {
      socket: { remoteAddress: '::ffff:10.0.0.5' },
    } as unknown as Request;
    expect(resolveClientIp(req)).toBe('10.0.0.5');
  });
});
