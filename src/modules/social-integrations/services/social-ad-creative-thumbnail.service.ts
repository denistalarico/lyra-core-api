import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SocialAdCredentialResolver } from '../credentials/social-ad-credential.resolver';
import { SocialAdEntity } from '../entities/social-ad-entity.entity';
import { MetaAdsGraphService } from './meta-ads-graph.service';

/**
 * How long a resolved image URL is reused.
 *
 * Meta signs these with an expiry of roughly five days, so this is not the
 * limiting factor — the cache exists so that a table of twenty ad rows does not
 * make twenty Graph calls every time somebody sorts a column. Ten minutes keeps
 * a page interactive without holding a URL long enough for its signature to
 * lapse. The same figure `SocialOrganicThumbnailService` uses, for the same
 * reason.
 */
const CACHE_TTL_MS = 10 * 60 * 1000;

/**
 * The most URLs held at once.
 *
 * A bound rather than an unbounded map: this is a long-lived singleton, and a
 * cache that only ever grows is a memory leak with a slow fuse. 500 is generous
 * against what a period actually holds — the production account delivered 3
 * distinct ads in a fortnight — and each ad carries its own creative, so there
 * is no sharing to collapse.
 */
const CACHE_MAX_ENTRIES = 500;

/**
 * The size asked of the creative node.
 *
 * The reason this service makes a request at all rather than reading a URL the
 * hierarchy sync could have collected for free. `thumbnail_width` and
 * `thumbnail_height` are **ignored on the `/ads` edge** — every URL it returns
 * is stamped `p64x64`, measured on the production account — and honoured here,
 * where the same creative answers `p320x320`. A 64-pixel image in a table row
 * is not a thumbnail, it is a smudge.
 *
 * Square, because the cell is: Meta crops to the requested box rather than
 * padding, and asking for the display aspect avoids a second crop in CSS.
 */
const THUMBNAIL_SIZE = '320';

type CacheEntry = { url: string; expiresAt: number };

/**
 * Resolves an ad creative's image URL at read time, so none is ever stored.
 *
 * The rule this service exists to enforce is the one
 * `SocialOrganicThumbnailService` already enforces for posts: **Meta's image
 * URLs are not durable and must not be persisted.** They are CDN links signed
 * with an `oe` parameter that expires in about five days, so a URL written into
 * a column renders correctly for a few days and then starts returning 403 — a
 * failure that surfaces long after the commit that caused it, looking like a
 * broken image rather than a stale cache. What the read model stores is
 * `social_ad_entities.creative_id`, which is stable; the picture is fetched on
 * demand through here.
 *
 * The token never leaves the server. The browser asks for a thumbnail by **ad**
 * id, this service proves that ad against the mirror inside the caller's own
 * scope, resolves the connection's credential, asks Meta about the creative
 * that ad actually names, and hands back a URL the browser can load directly —
 * which is why the response is a redirect target rather than proxied bytes.
 *
 * Keyed on the ad rather than the creative deliberately. A creative id accepted
 * from a query would be an identifier the caller could have obtained anywhere,
 * used to make a Graph call under someone else's credential; an ad id is looked
 * up in the mirror first, and the only creative ever requested is the one that
 * lookup returned.
 */
@Injectable()
export class SocialAdCreativeThumbnailService {
  private readonly logger = new Logger(SocialAdCreativeThumbnailService.name);
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    @InjectRepository(SocialAdEntity, 'agency')
    private readonly entitiesRepository: Repository<SocialAdEntity>,
    private readonly credentials: SocialAdCredentialResolver,
    private readonly graph: MetaAdsGraphService,
  ) {}

  /**
   * The current image URL for one ad's creative, or null when there is none.
   *
   * Null rather than an exception for every ordinary absence — an ad the mirror
   * has not seen, an ad whose creative Meta no longer serves, a credential that
   * cannot be resolved, a provider error. The caller renders a placeholder, and
   * a missing thumbnail never fails the page that was really about the numbers.
   */
  async resolve(input: {
    tenantId: string;
    workspaceId: string;
    agencyClientId: string | null;
    connectionId: string;
    adExternalId: string;
  }): Promise<string | null> {
    const key = [
      input.tenantId,
      input.workspaceId,
      input.agencyClientId ?? 'agency',
      input.connectionId,
      input.adExternalId,
    ].join(':');

    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.url;

    // Scope is proven against the read model before any credential is touched:
    // an ad id from a URL is not permission to read a connection, and this
    // lookup is what ties the two together inside the caller's own scope.
    const ad = await this.entitiesRepository.findOne({
      where: {
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        connectionId: input.connectionId,
        entityLevel: 'ad',
        externalId: input.adExternalId,
      },
      // `id` included deliberately: TypeORM 0.3.28 hydrates `findOne` to null
      // when every selected column is NULL in the row, and `creative_id` is
      // nullable. See `SocialAdCredentialResolver.resolvePersisted`.
      select: ['id', 'creativeId'],
    });

    // No row, or a row the sync has not learned a creative for. Both are
    // ordinary and both render a placeholder.
    if (!ad?.creativeId) return null;

    try {
      const credential = await this.credentials.resolve({
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        agencyClientId: input.agencyClientId,
        connectionId: input.connectionId,
      });

      const payload = await this.graph.readNode({
        accessToken: credential.accessToken,
        path: ad.creativeId,
        fields: 'thumbnail_url',
        params: {
          thumbnail_width: THUMBNAIL_SIZE,
          thumbnail_height: THUMBNAIL_SIZE,
        },
        failureMessage: 'Meta Ads creative read failed.',
      });

      const candidate = payload.thumbnail_url;

      // `https://` checked rather than assumed: the value is interpolated into
      // a redirect, and a scheme this code did not expect must not become one.
      return typeof candidate === 'string' && candidate.startsWith('https://')
        ? this.remember(key, candidate)
        : null;
    } catch (error) {
      // A thumbnail is decoration on a page whose subject is the metrics, so a
      // provider or credential failure degrades to a placeholder rather than an
      // error response. Logged at debug: on a disconnected account this would
      // otherwise repeat once per row per render.
      this.logger.debug(
        `Ad thumbnail unavailable for ${input.adExternalId}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
      return null;
    }
  }

  private remember(key: string, url: string): string {
    if (this.cache.size >= CACHE_MAX_ENTRIES) {
      // Oldest insertion first — Map preserves insertion order, so this evicts
      // the least recently *added* entry. Good enough for a cache whose entries
      // all expire on the same short timer.
      const oldest = this.cache.keys().next();
      if (!oldest.done) this.cache.delete(oldest.value);
    }

    this.cache.set(key, { url, expiresAt: Date.now() + CACHE_TTL_MS });

    return url;
  }
}
