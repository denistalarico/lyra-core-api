import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { SocialOrganicCredentialResolver } from '../credentials/social-organic-credential.resolver';
import { MetaOrganicGraphService } from '../providers/meta/meta-organic-graph.service';
import { SocialOrganicPostMetricDailyEntity } from './entities/social-organic-post-metric-daily.entity';

/**
 * How long a resolved image URL is reused.
 *
 * Meta signs these with an expiry of roughly five days, so this is not the
 * limiting factor — the cache exists so that a dashboard rendering twenty post
 * cards does not make twenty Graph calls every time somebody scrolls. Ten
 * minutes keeps a page interactive without holding a URL long enough for its
 * signature to lapse.
 */
const CACHE_TTL_MS = 10 * 60 * 1000;

/**
 * The most URLs held at once.
 *
 * A bound rather than an unbounded map: this is a long-lived singleton, and a
 * cache that only ever grows is a memory leak with a slow fuse.
 */
const CACHE_MAX_ENTRIES = 500;

type CacheEntry = { url: string; expiresAt: number };

/**
 * Resolves a post's image URL at read time, so none is ever stored.
 *
 * The rule this service exists to enforce: **Meta's image URLs are not durable
 * and must not be persisted.** They are CDN links signed with an `oe` parameter
 * that expires in about five days, so a URL written into a column renders
 * correctly for a few days and then starts returning 403 — a failure that
 * surfaces long after the commit that caused it, looking like a broken image
 * rather than a stale cache. What the read model stores is the post's id and
 * its `permalink`, both of which are stable; the picture is fetched on demand
 * through here.
 *
 * The token never leaves the server. The browser asks this service for a
 * thumbnail by post id, the service resolves the credential in the caller's
 * scope, asks Meta, and hands back a URL the browser can load directly — which
 * is why the response is a redirect target rather than proxied image bytes.
 */
@Injectable()
export class SocialOrganicThumbnailService {
  private readonly logger = new Logger(SocialOrganicThumbnailService.name);
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    @InjectRepository(SocialOrganicPostMetricDailyEntity, 'agency')
    private readonly postsRepository: Repository<SocialOrganicPostMetricDailyEntity>,
    private readonly credentials: SocialOrganicCredentialResolver,
    private readonly graph: MetaOrganicGraphService,
  ) {}

  /**
   * The current image URL for one post, or null when there is none to give.
   *
   * Null rather than an exception for every ordinary absence — an unknown post,
   * a provider that no longer serves the media, a credential that cannot be
   * resolved. The caller renders a placeholder, and a missing thumbnail never
   * fails the page that was really about the numbers.
   */
  async resolve(input: {
    tenantId: string;
    workspaceId: string;
    agencyClientId: string | null;
    assetId: string;
    externalPublicationId: string;
  }): Promise<string | null> {
    const key = [
      input.tenantId,
      input.workspaceId,
      input.agencyClientId ?? 'agency',
      input.assetId,
      input.externalPublicationId,
    ].join(':');

    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.url;

    // Scope is proven against the read model before any credential is touched:
    // a post id from a URL is not permission to read an asset, and this lookup
    // is what ties the two together inside the caller's own scope.
    const post = await this.postsRepository.findOne({
      where: {
        assetId: input.assetId,
        externalPublicationId: input.externalPublicationId,
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        agencyClientId: input.agencyClientId ?? IsNull(),
      },
      // `id` included deliberately: TypeORM 0.3.28 hydrates `findOne` to null
      // when every selected column is NULL in the row, and both of these are
      // nullable. See `SocialAdCredentialResolver.resolvePersisted`.
      select: ['id', 'externalPublicationId'],
    });

    if (!post) return null;

    try {
      const resolved = await this.credentials.resolvePersistedForAnalytics({
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        agencyClientId: input.agencyClientId,
        assetId: input.assetId,
      });

      const url = await this.graph.getMediaImageUrl({
        objectId: input.externalPublicationId,
        accessToken: resolved.credential.accessToken,
        assetType:
          resolved.credential.assetType === 'instagram_professional'
            ? 'instagram_professional'
            : 'facebook_page',
      });

      if (!url) return null;

      this.remember(key, url);

      return url;
    } catch (error) {
      // A thumbnail is decoration on a page whose subject is the metrics, so a
      // provider or credential failure degrades to a placeholder rather than an
      // error response. Logged at debug: on a disconnected account this would
      // otherwise repeat once per card per render.
      this.logger.debug(
        `Thumbnail unavailable for ${input.externalPublicationId}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
      return null;
    }
  }

  private remember(key: string, url: string): void {
    if (this.cache.size >= CACHE_MAX_ENTRIES) {
      // Oldest insertion first — Map preserves insertion order, so this evicts
      // the least recently *added* entry. Good enough for a cache whose entries
      // all expire on the same short timer.
      const oldest = this.cache.keys().next();
      if (!oldest.done) this.cache.delete(oldest.value);
    }

    this.cache.set(key, { url, expiresAt: Date.now() + CACHE_TTL_MS });
  }
}
