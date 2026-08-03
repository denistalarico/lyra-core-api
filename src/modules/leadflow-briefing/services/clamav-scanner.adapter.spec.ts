import { AddressInfo } from 'net';
import * as net from 'net';
import { ClamAvScannerAdapter } from './clamav-scanner.adapter';

/**
 * Minimal fake clamd server: reads the zINSTREAM command + length-prefixed
 * chunks until the zero-length terminator, then writes a canned response
 * and closes. Lets us exercise the real INSTREAM wire protocol without a
 * real ClamAV daemon.
 */
function startFakeClamd(
  onComplete: () => string | null, // null = never respond (used by the timeout test)
): Promise<net.Server> {
  return new Promise((resolve) => {
    const server = net.createServer((socket) => {
      let buffered = Buffer.alloc(0);
      let pastCommand = false;

      socket.on('data', (chunk: Buffer) => {
        buffered = Buffer.concat([buffered, chunk]);

        if (!pastCommand) {
          const nullIndex = buffered.indexOf(0);
          if (nullIndex === -1) return;
          buffered = buffered.subarray(nullIndex + 1);
          pastCommand = true;
        }

        // Walk length-prefixed chunks looking for the zero-length terminator.
        let offset = 0;
        while (offset + 4 <= buffered.length) {
          const length = buffered.readUInt32BE(offset);
          if (length === 0) {
            const response = onComplete();
            if (response !== null) {
              socket.end(response);
            }
            return;
          }
          if (offset + 4 + length > buffered.length) break; // wait for more data
          offset += 4 + length;
        }
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function portOf(server: net.Server): number {
  return (server.address() as AddressInfo).port;
}

function makeAdapter(port: number, timeoutMs = 2000) {
  const config = {
    get: (key: string) => {
      if (key === 'leadflowBriefing.clamav.host') return '127.0.0.1';
      if (key === 'leadflowBriefing.clamav.port') return port;
      if (key === 'leadflowBriefing.clamav.timeoutMs') return timeoutMs;
      return undefined;
    },
  };
  return new ClamAvScannerAdapter(config as never);
}

describe('ClamAvScannerAdapter', () => {
  let server: net.Server | undefined;

  afterEach((done) => {
    if (server) server.close(() => done());
    else done();
    server = undefined;
  });

  it('reports a clean scan for an "OK" response', async () => {
    server = await startFakeClamd(() => 'stream: OK\0');
    const adapter = makeAdapter(portOf(server));

    const result = await adapter.scan(Buffer.from('hello briefing content'));
    expect(result).toEqual({ clean: true });
  });

  it('reports an infected scan for a "FOUND" response', async () => {
    server = await startFakeClamd(() => 'stream: Eicar-Test-Signature FOUND\0');
    const adapter = makeAdapter(portOf(server));

    const result = await adapter.scan(Buffer.from('X5O!P%@AP[4\\PZX54(P^)'));
    expect(result).toEqual({ clean: false, signature: 'Eicar-Test-Signature' });
  });

  it('throws on a malformed/unexpected response', async () => {
    server = await startFakeClamd(() => 'not a real clamd reply\0');
    const adapter = makeAdapter(portOf(server));

    await expect(adapter.scan(Buffer.from('anything'))).rejects.toThrow(
      /clamav_unexpected_response/,
    );
  });

  it('fails closed when the connection is refused', async () => {
    // Nothing listening on this port.
    const closedServer = net.createServer();
    await new Promise<void>((resolve) => closedServer.listen(0, '127.0.0.1', resolve));
    const port = portOf(closedServer);
    await new Promise<void>((resolve) => closedServer.close(() => resolve()));

    const adapter = makeAdapter(port);
    await expect(adapter.scan(Buffer.from('anything'))).rejects.toThrow(
      /clamav_connection_error/,
    );
  });

  it('fails closed on timeout when the daemon never responds', async () => {
    server = await startFakeClamd(() => null); // never writes a response
    const adapter = makeAdapter(portOf(server), 150);

    await expect(adapter.scan(Buffer.from('anything'))).rejects.toThrow(/clamav_timeout/);
  });

  it('handles a large buffer split across multiple chunks', async () => {
    server = await startFakeClamd(() => 'stream: OK\0');
    const adapter = makeAdapter(portOf(server));

    const large = Buffer.alloc(200 * 1024, 0x41); // larger than CHUNK_SIZE (64 KiB)
    const result = await adapter.scan(large);
    expect(result).toEqual({ clean: true });
  });
});
