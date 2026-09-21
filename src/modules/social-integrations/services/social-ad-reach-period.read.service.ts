import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SocialAdReachPeriodEntity } from '../entities/social-ad-reach-period.entity';
import type { SocialAdReachEntityLevel } from '../entities/social-ad-reach-period.entity';

/**
 * The level the overview reads, pinned for the same reason every other analytics
 * read pins one.
 *
 * Only `account` is measured today, so this filter changes nothing yet — and it
 * is here precisely because that will not always be true. A lookup without it
 * would, the moment campaign-level measurements exist, be able to return one
 * campaign's reach as the account's, and the number would look entirely
 * plausible while being smaller than the truth.
 */
const REACH_ENTITY_LEVEL: SocialAdReachEntityLevel = 'account';

export type SocialAdReachPeriodLookup = {
  tenantId: string;
  workspaceId: string;
  connectionId: string;
  externalAccountId: string;
  since: string;
  until: string;
};

/** A cached measurement as the overview reports it. */
export type SocialAdPeriodReach = {
  /** A digit string, or null when Meta reported none for the range. */
  reach: string | null;
  measuredAt: Date;
  /** The range reached into an unfinished day when it was measured. */
  isPartial: boolean;
};

/**
 * Reads the period reach cache, and nothing else.
 *
 * ## Why this is a separate service from the one that measures
 *
 * `SocialAdReachPeriodService` holds `SocialAdCredentialResolver` and
 * `MetaAdsReachReaderService` — it exists to call Meta. Injecting that into the
 * analytics read path would put a token-capable dependency behind a dashboard
 * load, which is the precise failure
 * `analytics/social-analytics.boundary.spec.ts` was written to prevent: a page
 * that stops rendering ninety days of stored history because a credential
 * expired, and that spends provider quota per page view.
 *
 * The temptation is real and worth naming. The obvious design is one `resolve()`
 * that reads the cache and measures on a miss — the campaign plan itself
 * sketches it that way. It is wrong for a *read* path: a period nobody prewarmed
 * would turn one dashboard load into a synchronous Graph request, unbounded in
 * latency, rate-limitable, and failing for reasons the page cannot explain. So
 * the read answers from the cache or answers `null`, and the measuring happens
 * on the sync side, where a provider call already belongs. `resolve()` still
 * exists — on the writing service, for the callers that may legitimately spend a
 * request.
 *
 * This class therefore holds one repository, no resolver, no Graph service and
 * no token, and would answer identically for a disconnected account — because a
 * measurement taken last week is still true.
 */
@Injectable()
export class SocialAdReachPeriodReadService {
  constructor(
    @InjectRepository(SocialAdReachPeriodEntity, 'agency')
    private readonly reachRepository: Repository<SocialAdReachPeriodEntity>,
  ) {}

  /**
   * The measurement of this exact range, or null.
   *
   * **Equality on both endpoints, never a range scan.** This is the rule that
   * makes the cache correct: a `BETWEEN` or an ordered `LIMIT 1` would happily
   * return a nested range's measurement — a 7-day reach reported as a 30-day
   * reach, smaller than the truth and impossible for a reader to catch. There is
   * no such thing as an approximately right reach row.
   *
   * A partial row is returned rather than withheld, and the flag travels with
   * it. A range that includes today is genuinely a subtotal, and the honest
   * presentation is the number plus when it was taken — which is the same
   * treatment `hasPartialData` already gets on the overview. Hiding it would
   * leave the dashboard with nothing to show for "hoje" and "últimos 7 dias",
   * which are the two periods people look at most.
   */
  async find(
    lookup: SocialAdReachPeriodLookup,
  ): Promise<SocialAdPeriodReach | null> {
    const row = await this.reachRepository.findOne({
      where: {
        tenantId: lookup.tenantId,
        workspaceId: lookup.workspaceId,
        connectionId: lookup.connectionId,
        entityLevel: REACH_ENTITY_LEVEL,
        entityExternalId: lookup.externalAccountId,
        periodSince: lookup.since,
        periodUntil: lookup.until,
      },
      select: ['reach', 'measuredAt', 'isPartial'],
    });

    if (!row) return null;

    return {
      reach: row.reach,
      measuredAt: row.measuredAt,
      isPartial: row.isPartial,
    };
  }
}
