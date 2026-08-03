import * as http from 'http';
import { AddressInfo } from 'net';

// This file exercises the actual undici request/redirect/streaming mechanics
// against a real local HTTP server. The IP-safety guard itself (isPublicIp)
// is unit-tested exhaustively in ip-guard.util.spec.ts and re-verified
// end-to-end (without mocking) in ssrf-safe-url-fetcher.service.spec.ts — we
// can't test a successful fetch against a real *public* address without
// depending on network access in CI, so here we mock isPublicIp to allow
// 127.0.0.1 through and prove the rest of the pipeline (redirects, hop
// limits, streaming byte cap, status handling) is correct.
jest.mock('./ip-guard.util', () => ({ isPublicIp: jest.fn().mockReturnValue(true) }));
// Same reasoning as the isPublicIp mock above: production only allows the
// default port per protocol, but test servers must bind an ephemeral port.
jest.mock('./url-policy.util', () => ({
  isAllowedProtocol: jest.fn().mockReturnValue(true),
  isAllowedPort: jest.fn().mockReturnValue(true),
}));

import { SsrfSafeUrlFetcherService } from './ssrf-safe-url-fetcher.service';

const OPTS = { maxBytes: 1024, timeoutMs: 2000 };

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
  });
}

function close(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

describe('SsrfSafeUrlFetcherService (HTTP mechanics, IP guard mocked to allow 127.0.0.1)', () => {
  const service = new SsrfSafeUrlFetcherService();
  let server: http.Server;
  let port: number;

  afterEach(async () => {
    if (server) await close(server);
  });

  it('fetches a small body and returns its content-type', async () => {
    server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('hello briefing source');
    });
    port = await listen(server);

    const result = await service.fetchUrl(`http://127.0.0.1:${port}/`, OPTS);
    expect(result.body.toString()).toBe('hello briefing source');
    expect(result.contentType).toBe('text/plain');
  });

  it('follows a redirect and fetches the final target', async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/start') {
        res.writeHead(302, { Location: '/final' });
        res.end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('final content');
    });
    port = await listen(server);

    const result = await service.fetchUrl(`http://127.0.0.1:${port}/start`, OPTS);
    expect(result.body.toString()).toBe('final content');
  });

  it('rejects a redirect chain that never terminates', async () => {
    server = http.createServer((req, res) => {
      res.writeHead(302, { Location: '/loop' });
      res.end();
    });
    port = await listen(server);

    await expect(service.fetchUrl(`http://127.0.0.1:${port}/loop`, OPTS)).rejects.toThrow(
      /Too many redirects/,
    );
  });

  it('rejects a non-2xx, non-redirect status', async () => {
    server = http.createServer((req, res) => {
      res.writeHead(500);
      res.end('server error');
    });
    port = await listen(server);

    await expect(service.fetchUrl(`http://127.0.0.1:${port}/`, OPTS)).rejects.toThrow(
      /status 500/,
    );
  });

  it('enforces the byte cap while streaming, regardless of Content-Length', async () => {
    server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      // Send well over the 1024-byte cap, in small chunks so it's genuinely streamed.
      const chunk = Buffer.alloc(256, 0x41);
      for (let i = 0; i < 10; i++) res.write(chunk);
      res.end();
    });
    port = await listen(server);

    await expect(service.fetchUrl(`http://127.0.0.1:${port}/`, OPTS)).rejects.toThrow(
      /exceeds the allowed size/,
    );
  });
});
