import { BadRequestException, Injectable } from '@nestjs/common';
import { promises as dns, type LookupAddress } from 'dns';
import { Agent, request } from 'undici';
import { isPublicIp } from './ip-guard.util';
import { isAllowedPort, isAllowedProtocol } from './url-policy.util';

const MAX_REDIRECTS = 3;
const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);

export interface FetchUrlOptions {
  maxBytes: number;
  timeoutMs: number;
}

export interface FetchUrlResult {
  body: Buffer;
  contentType: string | null;
}

/**
 * Fetches a user-supplied URL server-side while resisting SSRF: only
 * http(s) on default ports, DNS resolution is validated against
 * private/loopback/link-local ranges, and the TCP connection is pinned to
 * the already-validated IP (via undici's connect.lookup) so a second DNS
 * resolution at connect time can't return a different (rebound) address.
 * Redirects are followed manually — every hop is revalidated from scratch —
 * and the response body is capped while streaming, not after buffering.
 */
@Injectable()
export class SsrfSafeUrlFetcherService {
  async fetchUrl(url: string, opts: FetchUrlOptions): Promise<FetchUrlResult> {
    let currentUrl = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const parsed = this.parseAndValidateUrl(currentUrl);
      const pinnedIp = await this.resolvePinnedIp(parsed.hostname);

      const agent = new Agent({
        connect: {
          lookup: (_hostname, _options, callback) => {
            callback(null, pinnedIp.address, pinnedIp.family);
          },
          timeout: opts.timeoutMs,
        },
      });

      try {
        // undici's request() never auto-follows redirects (unlike fetch()),
        // so 3xx responses land here to be revalidated and followed by hand.
        const response = await request(parsed.toString(), {
          dispatcher: agent,
          method: 'GET',
          headersTimeout: opts.timeoutMs,
          bodyTimeout: opts.timeoutMs,
        });

        if (REDIRECT_STATUS_CODES.has(response.statusCode)) {
          await response.body.dump().catch(() => undefined);
          const location = response.headers.location;
          if (!location || Array.isArray(location)) {
            throw new BadRequestException('Redirect without a valid Location header.');
          }
          currentUrl = new URL(location, parsed).toString();
          continue;
        }

        if (response.statusCode < 200 || response.statusCode >= 300) {
          await response.body.dump().catch(() => undefined);
          throw new BadRequestException(`URL fetch failed with status ${response.statusCode}.`);
        }

        const body = await this.readBodyWithCap(response.body, opts.maxBytes);
        const contentTypeHeader = response.headers['content-type'];
        return {
          body,
          contentType: Array.isArray(contentTypeHeader)
            ? (contentTypeHeader[0] ?? null)
            : (contentTypeHeader ?? null),
        };
      } finally {
        await agent.close();
      }
    }
    throw new BadRequestException('Too many redirects.');
  }

  private parseAndValidateUrl(url: string): URL {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new BadRequestException('Invalid URL.');
    }
    if (!isAllowedProtocol(parsed.protocol)) {
      throw new BadRequestException('Only http(s) URLs are allowed.');
    }
    if (!isAllowedPort(parsed.protocol, parsed.port)) {
      throw new BadRequestException('Only default HTTP(S) ports are allowed.');
    }
    return parsed;
  }

  private async resolvePinnedIp(
    hostname: string,
  ): Promise<{ address: string; family: 4 | 6 }> {
    let addresses: LookupAddress[];
    try {
      addresses = await dns.lookup(hostname, { all: true, verbatim: true });
    } catch {
      throw new BadRequestException('Could not resolve host.');
    }
    if (addresses.length === 0) {
      throw new BadRequestException('Could not resolve host.');
    }
    if (!addresses.every((entry) => isPublicIp(entry.address))) {
      throw new BadRequestException('URL resolves to a disallowed network address.');
    }
    const chosen = addresses[0];
    return { address: chosen.address, family: chosen.family as 4 | 6 };
  }

  private async readBodyWithCap(
    body: AsyncIterable<Buffer>,
    maxBytes: number,
  ): Promise<Buffer> {
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of body) {
      total += chunk.length;
      if (total > maxBytes) {
        const destroy = (body as { destroy?: () => void }).destroy;
        if (typeof destroy === 'function') destroy.call(body);
        throw new BadRequestException('Response body exceeds the allowed size.');
      }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
}
