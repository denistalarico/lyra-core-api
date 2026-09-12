import { Injectable } from '@nestjs/common';
import { FilesService } from '../../../common/files/files.service';
import type { MediaPreparationInput } from '../providers/social-publisher.adapter';

/**
 * Identifies one already-stored, private-bucket media object. `mediaAssetId`
 * resolution (Creative Studio asset, Brand Kit asset, direct upload — §11.4)
 * happens upstream of this service; by the time a `ResolvedMediaObject`
 * reaches here it is just a storage object, so preparation cannot branch on
 * where the operator got it (ADR-014).
 */
export type ResolvedMediaObject = {
  readonly storagePath: string;
  readonly mimeType: string;
  readonly bytes: number;
};

export type PrepareMediaForPublishInput = {
  readonly media: ResolvedMediaObject;
  readonly provider: string;
  readonly placement: string;
  readonly ttlSeconds?: number;
};

type CachedRendition = {
  readonly input: PreparedSource;
  readonly expiresAt: number;
};

type PreparedSource = Pick<MediaPreparationInput, 'sourceUrl' | 'mimeType' | 'bytes'>;

/**
 * Turns a resolved storage object into what `SocialPublisherAdapter.prepareMedia`
 * needs (blueprint §11.2): a short-TTL presigned GET, never a public URL
 * (§11.3 r.1, T23). Derived per `(asset, provider, placement)` and cached
 * (§11.3 r.3) so repeated preparation for the same triple — a retried publish,
 * a second placement resolved moments apart — does not mint a fresh bearer URL
 * every time.
 *
 * Cache is process-local and in-memory: this module has no database or Redis
 * wiring (consistent with `M1`/`M2`), and a presigned URL is cheap to
 * regenerate on a cold cache or a different process.
 */
@Injectable()
export class MediaPreparationService {
  private readonly renditionCache = new Map<string, CachedRendition>();

  constructor(private readonly filesService: FilesService) {}

  async prepare(
    input: PrepareMediaForPublishInput,
  ): Promise<PreparedSource> {
    const cacheKey = this.renditionCacheKey(
      input.media.storagePath,
      input.provider,
      input.placement,
    );

    const cached = this.renditionCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.input;
    }

    const presigned = await this.filesService.getPresignedGetUrl({
      bucket: 'private',
      path: input.media.storagePath,
      ttlSeconds: input.ttlSeconds,
    });

    const prepared: PreparedSource = {
      sourceUrl: presigned.url,
      mimeType: input.media.mimeType,
      bytes: input.media.bytes,
    };

    // A small safety margin so a cached URL is never handed out moments
    // before it expires on the provider's end.
    const cacheTtlMs = Math.max(presigned.expiresInSeconds - 10, 0) * 1000;
    this.renditionCache.set(cacheKey, {
      input: prepared,
      expiresAt: Date.now() + cacheTtlMs,
    });

    return prepared;
  }

  private renditionCacheKey(
    storagePath: string,
    provider: string,
    placement: string,
  ): string {
    return `${storagePath}::${provider}::${placement}`;
  }
}
