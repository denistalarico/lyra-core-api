import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Socket } from 'net';
import type { MalwareScanResult, MalwareScannerAdapter } from './malware-scanner.adapter';

const CHUNK_SIZE = 64 * 1024;

/**
 * Talks to clamd directly over its TCP INSTREAM protocol (no shell-exec, no
 * local binary requirement): `zINSTREAM\0` + length-prefixed chunks + a
 * zero-length terminator, then a single text reply ("stream: OK" /
 * "stream: <name> FOUND"). Any socket error, timeout, or unparseable
 * response is thrown — callers must treat that as fail-closed (reject the
 * file), never as "assume clean".
 */
@Injectable()
export class ClamAvScannerAdapter implements MalwareScannerAdapter {
  private readonly host: string;
  private readonly port: number;
  private readonly timeoutMs: number;

  constructor(private readonly configService: ConfigService) {
    this.host = this.configService.get<string>('leadflowBriefing.clamav.host') ?? 'localhost';
    this.port = this.configService.get<number>('leadflowBriefing.clamav.port') ?? 3310;
    this.timeoutMs = this.configService.get<number>('leadflowBriefing.clamav.timeoutMs') ?? 15000;
  }

  async scan(buffer: Buffer): Promise<MalwareScanResult> {
    const raw = await this.instream(buffer);
    return this.parseResponse(raw);
  }

  private instream(buffer: Buffer): Promise<string> {
    return new Promise((resolve, reject) => {
      const socket = new Socket();
      const chunks: Buffer[] = [];
      let settled = false;

      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        reject(error);
      };

      const succeed = () => {
        if (settled) return;
        settled = true;
        resolve(Buffer.concat(chunks).toString('utf8'));
      };

      socket.setTimeout(this.timeoutMs);
      socket.once('timeout', () => fail(new Error('clamav_timeout')));
      socket.once('error', (error: Error) =>
        fail(new Error(`clamav_connection_error: ${error.message}`)),
      );

      socket.once('connect', () => {
        socket.write('zINSTREAM\0');
        let offset = 0;
        while (offset < buffer.length) {
          const chunk = buffer.subarray(offset, offset + CHUNK_SIZE);
          const sizeHeader = Buffer.alloc(4);
          sizeHeader.writeUInt32BE(chunk.length, 0);
          socket.write(sizeHeader);
          socket.write(chunk);
          offset += chunk.length;
        }
        socket.write(Buffer.alloc(4)); // zero-length chunk terminates the stream
      });

      socket.on('data', (data: Buffer) => chunks.push(data));
      socket.once('end', succeed);
      socket.once('close', () => {
        if (settled) return;
        if (chunks.length > 0) succeed();
        else fail(new Error('clamav_connection_closed_without_response'));
      });

      socket.connect(this.port, this.host);
    });
  }

  private parseResponse(raw: string): MalwareScanResult {
    const response = raw.replace(/\0/g, '').trim();
    if (response.endsWith('OK')) {
      return { clean: true };
    }
    const foundMatch = response.match(/^stream:\s*(.+?)\s+FOUND$/);
    if (foundMatch) {
      return { clean: false, signature: foundMatch[1] };
    }
    throw new Error(`clamav_unexpected_response: ${response || '(empty)'}`);
  }
}
