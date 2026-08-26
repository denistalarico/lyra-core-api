import { Injectable } from '@nestjs/common';
import type { ResolvedAdCredential } from '../credentials/resolved-ad-credential';
import type {
  NormalizedAdEntity,
  NormalizedAdEntityPage,
} from '../sync/meta-ads-entity.contract';
import {
  normalizeAccount,
  normalizeAd,
  normalizeAdSet,
  normalizeCampaign,
} from '../sync/meta-ads-entity.normalizer';
import { MetaAdsGraphService } from './meta-ads-graph.service';

/**
 * Fields asked for at each level.
 *
 * Deliberately short lists. Every field is a column Meta has to assemble, and
 * the Marketing API bills a shared business quota by cost rather than by call
 * count — asking for the creative payload, the targeting spec or the ad image
 * on an account with thousands of ads is how a hierarchy sync starves the
 * insights reader that runs next. Nothing below is decorative: each field
 * either lands in a column or decides a parent.
 */
const ACCOUNT_FIELDS =
  'id,account_id,name,currency,timezone_name,account_status,business{id,name}';

const CAMPAIGN_FIELDS =
  'id,name,status,effective_status,objective,daily_budget,lifetime_budget,' +
  'budget_remaining,start_time,stop_time,created_time,updated_time';

const ADSET_FIELDS =
  'id,name,campaign_id,status,effective_status,optimization_goal,billing_event,' +
  'daily_budget,lifetime_budget,budget_remaining,start_time,end_time,' +
  'created_time,updated_time';

const AD_FIELDS =
  'id,name,adset_id,campaign_id,status,effective_status,created_time,updated_time';

/**
 * Rows per page and pages per level.
 *
 * 200 × 50 is 10 000 objects per level. The page size is well inside what the
 * edges accept and keeps the call count low; the ceiling exists so a looping or
 * hostile response cannot hold a synchronous request open forever. Hitting it
 * is not silently tolerated — the walker reports truncation and the sync
 * refuses to archive a level it only partly saw.
 */
const PAGE_SIZE = 200;
const MAX_PAGES = 50;

/**
 * Read-only reader for the Meta ad hierarchy.
 *
 * It receives a `ResolvedAdCredential` and cannot tell how the connection was
 * authorized: `business_login` and `internal_system_user` differ only inside
 * `SocialAdCredentialResolver`, and reproducing that branch here — even as an
 * innocent `if` about where the token came from — is the exact drift the
 * credential boundary exists to prevent.
 *
 * Read-only in the strict sense: every call is a GET against a reporting edge.
 * S2 asks Meta for `ads_read` only, so a write edge would fail with code 294
 * rather than change anything, but the reason nothing here writes is that
 * nothing here should.
 */
@Injectable()
export class MetaAdsEntityReaderService {
  constructor(private readonly graphService: MetaAdsGraphService) {}

  /**
   * The account node itself.
   *
   * Read from the account the credential is bound to, never from a caller
   * argument: the resolver already validated that handle (and, for the internal
   * System User, re-validated it against configuration), so taking it from
   * anywhere else would reintroduce the drift that check closes.
   */
  async readAccount(
    credential: ResolvedAdCredential,
  ): Promise<NormalizedAdEntity | null> {
    const payload = await this.graphService.readNode({
      accessToken: credential.accessToken,
      path: credential.externalAccountId,
      fields: ACCOUNT_FIELDS,
      failureMessage: 'Meta Ads account read failed.',
    });

    return normalizeAccount(payload, credential.externalAccountId);
  }

  async readCampaigns(
    credential: ResolvedAdCredential,
    context: { currency: string | null },
  ): Promise<NormalizedAdEntityPage> {
    const page = await this.readLevel(credential, 'campaigns', CAMPAIGN_FIELDS);

    return this.collect(page, (row) =>
      normalizeCampaign(row, {
        accountExternalId: credential.externalAccountId,
        currency: context.currency,
      }),
    );
  }

  async readAdSets(
    credential: ResolvedAdCredential,
    context: { currency: string | null },
  ): Promise<NormalizedAdEntityPage> {
    const page = await this.readLevel(credential, 'adsets', ADSET_FIELDS);

    return this.collect(page, (row) => normalizeAdSet(row, context));
  }

  async readAds(
    credential: ResolvedAdCredential,
    context: {
      currency: string | null;
      campaignByAdSetId: ReadonlyMap<string, string>;
    },
  ): Promise<NormalizedAdEntityPage> {
    const page = await this.readLevel(credential, 'ads', AD_FIELDS);

    return this.collect(page, (row) => normalizeAd(row, context));
  }

  /**
   * Ad set → campaign, for ads whose payload omits `campaign_id`.
   *
   * Built from the ad sets this same run already read, which is what keeps the
   * ad level from costing one Graph call per ad.
   */
  static campaignByAdSetId(
    adSets: readonly NormalizedAdEntity[],
  ): ReadonlyMap<string, string> {
    const map = new Map<string, string>();

    for (const adSet of adSets) {
      if (adSet.campaignExternalId) {
        map.set(adSet.externalId, adSet.campaignExternalId);
      }
    }

    return map;
  }

  private readLevel(
    credential: ResolvedAdCredential,
    edge: 'campaigns' | 'adsets' | 'ads',
    fields: string,
  ) {
    // Meta's default filtering applies: these edges answer with everything but
    // deleted and archived objects. That is the behaviour this mirror wants —
    // an object archived in Ads Manager stops coming back, the sync stops
    // seeing it, and it is archived here too rather than deleted.
    return this.graphService.readEdge({
      accessToken: credential.accessToken,
      path: `${credential.externalAccountId}/${edge}`,
      fields,
      limit: PAGE_SIZE,
      maxPages: MAX_PAGES,
      failureMessage: `Meta Ads ${edge} read failed.`,
    });
  }

  private collect(
    page: { rows: unknown[]; truncated: boolean },
    normalize: (row: unknown) => NormalizedAdEntity | null,
  ): NormalizedAdEntityPage {
    const rows: NormalizedAdEntity[] = [];
    let skipped = 0;

    for (const candidate of page.rows) {
      const normalized = normalize(candidate);

      if (normalized) {
        rows.push(normalized);
      } else {
        // Counted rather than thrown: one unkeyable row out of ten thousand is
        // a provider oddity, and failing the whole level over it would leave
        // the account with no mirror at all. The count is what makes it
        // visible in the summary.
        skipped += 1;
      }
    }

    return { rows, truncated: page.truncated, skipped };
  }
}
