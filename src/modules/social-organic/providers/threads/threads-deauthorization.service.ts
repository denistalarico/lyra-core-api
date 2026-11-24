import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { In, Repository } from 'typeorm';
import { SocialOrganicConnectionService } from '../../connections/social-organic-connection.service';
import { SocialOrganicAssetEntity } from '../../entities';
import {
  THREADS_ACCOUNT_ASSET_TYPE,
  THREADS_PROVIDER,
} from './threads-capabilities';
import { requireThreadsAppConfig } from './threads-oauth.support';

export class ThreadsSignedRequestError extends Error {
  constructor() {
    super('threads_signed_request_invalid');
    this.name = 'ThreadsSignedRequestError';
  }
}

function base64UrlDecode(value: string): Buffer {
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/**
 * Meta's `signed_request`: `<sig>.<payload>`, both base64url, where
 * `sig = HMAC-SHA256(payload, app secret)`. Returns the app-scoped Threads
 * user id, or throws when the signature or the payload does not hold.
 */
export function readThreadsSignedRequest(
  signedRequest: unknown,
  secret: string,
): string {
  if (typeof signedRequest !== 'string') throw new ThreadsSignedRequestError();
  const [signature, payload, extra] = signedRequest.split('.');
  if (!signature || !payload || extra !== undefined) {
    throw new ThreadsSignedRequestError();
  }
  const expected = createHmac('sha256', secret).update(payload).digest();
  const received = base64UrlDecode(signature);
  if (
    received.length !== expected.length ||
    !timingSafeEqual(received, expected)
  ) {
    throw new ThreadsSignedRequestError();
  }
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(base64UrlDecode(payload).toString('utf8')) as Record<
      string,
      unknown
    >;
  } catch {
    throw new ThreadsSignedRequestError();
  }
  const algorithm =
    typeof data.algorithm === 'string' ? data.algorithm.toUpperCase() : '';
  const userId =
    typeof data.user_id === 'string' || typeof data.user_id === 'number'
      ? String(data.user_id)
      : '';
  if (algorithm !== 'HMAC-SHA256' || !/^\d+$/.test(userId)) {
    throw new ThreadsSignedRequestError();
  }
  return userId;
}

/**
 * The uninstall and data deletion callbacks of the Threads use case. Both
 * disconnect every Lyra connection of that Threads profile through the
 * ordinary disconnect (credentials removed, assets revoked, queued
 * publications cancelled). Metrics already collected stay, as after a
 * manual disconnect.
 */
@Injectable()
export class ThreadsDeauthorizationService {
  private readonly logger = new Logger(ThreadsDeauthorizationService.name);

  constructor(
    @InjectRepository(SocialOrganicAssetEntity, 'agency')
    private readonly assets: Repository<SocialOrganicAssetEntity>,
    private readonly connections: SocialOrganicConnectionService,
  ) {}

  verify(signedRequest: unknown): string {
    return readThreadsSignedRequest(
      signedRequest,
      requireThreadsAppConfig().secret,
    );
  }

  async disconnectUser(userId: string): Promise<number> {
    const assets = await this.assets.find({
      where: {
        provider: THREADS_PROVIDER,
        assetType: THREADS_ACCOUNT_ASSET_TYPE,
        externalAssetId: userId,
        status: In(['active', 'permission_lost']),
      },
    });
    const seen = new Set<string>();
    for (const asset of assets) {
      if (seen.has(asset.connectionId)) continue;
      seen.add(asset.connectionId);
      try {
        await this.connections.disconnect({
          connectionId: asset.connectionId,
          tenantId: asset.tenantId,
          workspaceId: asset.workspaceId,
          agencyClientId: asset.agencyClientId,
          companyContextId: asset.companyContextId,
        });
      } catch (error) {
        this.logger.warn(
          `Threads deauthorization: disconnect failed (${
            error instanceof Error ? error.name : 'unknown_error'
          })`,
        );
      }
    }
    return seen.size;
  }

  /** Meta shows this code to the person; the URL is where they can follow up. */
  deletionReceipt(): { url: string; confirmation_code: string } {
    const code = randomUUID();
    const base =
      process.env.APP_FRONTEND_URL?.trim() || 'https://lyrasuite.com';
    const url = new URL('/privacy', base);
    url.searchParams.set('threads_deletion', code);
    return { url: url.toString(), confirmation_code: code };
  }
}
