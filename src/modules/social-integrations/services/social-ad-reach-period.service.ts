import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import type { ResolvedAdCredential } from '../credentials/resolved-ad-credential';
import {
  SocialAdCredentialResolver,
  type SocialAdCredentialScope,
} from '../credentials/social-ad-credential.resolver';
import { parseAnalyticsPeriod } from '../analytics/social-ad-analytics-period';
import { SocialAdReachPeriodEntity } from '../entities/social-ad-reach-period.entity';
import type { SocialAdReachEntityLevel } from '../entities/social-ad-reach-period.entity';
import { currentDayIn } from '../sync/insights-window';
import {
  isPartialReachWindow,
  resolveReachPresets,
  type NormalizedAdReachPeriod,
  type SocialAdReachPeriodWindow,
  type SocialAdReachPresetId,
} from '../sync/social-ad-reach-period.contract';
import { SocialAdReachMeasurementDisabledError } from '../sync/social-ad-reach-period.error';
import { describeSocialAdSyncFailure } from '../sync/social-ad-sync.http-error';
import { MetaAdsReachReaderService } from './meta-ads-reach-reader.service';
import { SocialAdReachPeriodConfigService } from './social-ad-reach-period-config.service';

/**
 * The level measurements are taken at.
 *
 * Account only, and for the arithmetic reason §2.1 of the plan gives: a
 * per-campaign measurement is one Graph request *per campaign per period*, so an
 * account with 40 campaigns and six presets is 240 requests a day to answer a
 * question no chart asks. The account's own reach is what a dashboard header
 * reports and what reconciles against Ads Manager.
 *
 * A constant rather than a parameter, like `BREAKDOWN_LEVEL`: the table's unique
 * key carries the level, so raising this later is a change here and nowhere
 * else.
 */
const MEASUREMENT_LEVEL: SocialAdReachEntityLevel = 'account';

/**
 * Columns a re-measurement refreshes.
 *
 * `reach`, `is_partial` and `measured_at` — the measurement and everything that
 * qualifies it. `created_at` is absent on purpose: it answers "when did Lyra
 * first measure this range", and a write that overwrote it would reset that
 * answer every time a partial range was re-read.
 *
 * The seven identity columns are absent because they are the conflict target:
 * they are what matched, so writing them would be writing them to themselves.
 */
const REFRESHED_REACH_COLUMNS = [
  'agency_client_id',
  'provider',
  'account_timezone',
  'reach',
  'is_partial',
  'measured_at',
  'updated_at',
];

/** Mirrors `UQ_social_ad_reach_periods_measurement` exactly. */
const REACH_IDENTITY_COLUMNS = [
  'tenant_id',
  'workspace_id',
  'connection_id',
  'entity_level',
  'entity_external_id',
  'period_since',
  'period_until',
];

export type ResolveReachPeriodInput = SocialAdCredentialScope & {
  connectionId: string;
  /** Unvalidated: `parseAnalyticsPeriod` is what decides they are real days. */
  since: unknown;
  until: unknown;
};

/** What one measurement produced, for a caller that asked for one. */
export type SocialAdReachPeriodResult = {
  connectionId: string;
  since: string;
  until: string;
  reach: string | null;
  isPartial: boolean;
  measuredAt: string;
  /** True when the answer came from the cache and cost no provider request. */
  fromCache: boolean;
};

export type SocialAdReachPresetOutcome = {
  preset: SocialAdReachPresetId;
  since: string;
  until: string;
  status: 'measured' | 'cached' | 'failed';
  reach: string | null;
  isPartial: boolean;
  /** Present only on a failed preset: a stable code and a fixed message. */
  code?: string;
  message?: string;
};

export type SocialAdReachPrewarmSummary = {
  connectionId: string;
  today: string;
  accountTimezone: string;
  presets: SocialAdReachPresetOutcome[];
  measured: number;
  cached: number;
  failed: number;
  apiCalls: number;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
};

/**
 * Measures the de-duplicated reach of a calendar range and caches it.
 *
 * ## The invariant this service exists to hold
 *
 * **Reach is never summed here or anywhere.** A row of
 * `social_ad_reach_periods` answers one question — the reach of one exact range
 * — and is read back only by equality on both endpoints. The number in it was
 * computed by Meta over identities this system never sees, which is why it can
 * exist at all and why nothing local can derive a neighbouring range's from it.
 *
 * ## Why `resolve` may call a provider and the overview may not
 *
 * This class holds a credential resolver and a Graph reader. That makes it a
 * *sync-side* component, and it is deliberately not reachable from the analytics
 * read path — `SocialAdReachPeriodReadService` is what the overview injects, and
 * it can only read the cache. A dashboard load that measured on a miss would
 * spend quota per page view and fail whenever a token expired, which is the
 * whole failure mode the analytics boundary spec guards.
 *
 * So `resolve` exists for callers that may legitimately spend a request — the
 * prewarm pass, and a manual measurement an operator asked for — and the read
 * path answers `null` for a range nobody has measured yet.
 */
@Injectable()
export class SocialAdReachPeriodService {
  private readonly logger = new Logger(SocialAdReachPeriodService.name);

  constructor(
    @InjectRepository(SocialAdReachPeriodEntity, 'agency')
    private readonly reachRepository: Repository<SocialAdReachPeriodEntity>,
    private readonly credentialResolver: SocialAdCredentialResolver,
    private readonly config: SocialAdReachPeriodConfigService,
    private readonly reader: MetaAdsReachReaderService,
  ) {}

  /**
   * One range: from the cache when it is final there, from Meta otherwise.
   *
   * Two conditions send this to the provider, and only two:
   *
   * 1. **No row.** Nothing has measured this range.
   * 2. **A partial row.** Its `period_until` was the account's today when it was
   *    taken, so the number is a subtotal that has since grown.
   *
   * A final row is returned untouched, forever. That is not a staleness
   * tolerance — it is the property of the data: a closed range's audience does
   * not change. Meta restates spend and conversions for up to 28 days, but a
   * late-attributed conversion lands on a day whose reach was already counted.
   *
   * The gate is checked before the credential lookup, because it is a property of
   * the deployment rather than of the request: answering it costs nothing and
   * reveals nothing about whether the connection exists.
   *
   * The range is validated by `parseAnalyticsPeriod`, not by
   * `parseInsightsWindow`, and the choice matters in both directions. It allows a
   * year rather than 90 days, because the limit that applies to an *ingest* is
   * Meta's restatement horizon and this is one row regardless of length. And it
   * has no closed-day rule: a range that includes today is the normal case here —
   * "hoje" and "últimos 7 dias" are the two periods people look at most — and the
   * `is_partial` flag plus a re-measure is how that is handled rather than a
   * refusal.
   */
  async resolve(
    input: ResolveReachPeriodInput,
  ): Promise<SocialAdReachPeriodResult> {
    if (!this.config.enabled) {
      throw new SocialAdReachMeasurementDisabledError();
    }

    // Before the credential lookup: an unusable range is the caller's mistake,
    // and answering it costs no provider quota and reveals nothing about whether
    // the connection exists.
    const period = parseAnalyticsPeriod({
      since: input.since,
      until: input.until,
    });

    const credential = await this.credentialResolver.resolve({
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      agencyClientId: input.agencyClientId,
      companyContextId: input.companyContextId ?? null,
      connectionId: input.connectionId,
    });

    const window = { since: period.since, until: period.until };
    const today = currentDayIn(credential.timezone);

    const cached = await this.findCached(credential, window);

    // A final measurement is the answer. Only a partial one is worth a request.
    if (cached && !cached.isPartial) {
      return {
        connectionId: credential.connectionId,
        since: window.since,
        until: window.until,
        reach: cached.reach,
        isPartial: false,
        measuredAt: cached.measuredAt.toISOString(),
        fromCache: true,
      };
    }

    const measured = await this.measure({ credential, window, today });

    return {
      connectionId: credential.connectionId,
      since: window.since,
      until: window.until,
      reach: measured.reach,
      isPartial: measured.isPartial,
      measuredAt: measured.measuredAt.toISOString(),
      fromCache: false,
    };
  }

  /**
   * Resolves one connection's credential and prewarms its presets.
   *
   * The entry point the scheduler calls, and the only reason it is separate from
   * `prewarm`: the scheduler walks connection rows, which carry no credential,
   * while `prewarm` takes one because a caller that already resolved must not
   * resolve twice. The gate is checked here rather than inside `prewarm` for the
   * same reason it is checked in `resolve` — before any lookup, because it is a
   * property of the deployment rather than of the connection.
   */
  async prewarmConnection(
    input: SocialAdCredentialScope & { connectionId: string; now?: Date },
  ): Promise<SocialAdReachPrewarmSummary> {
    if (!this.config.enabled) {
      throw new SocialAdReachMeasurementDisabledError();
    }

    const credential = await this.credentialResolver.resolve({
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      agencyClientId: input.agencyClientId,
      companyContextId: input.companyContextId ?? null,
      connectionId: input.connectionId,
    });

    return this.prewarm({ credential, now: input.now });
  }

  /**
   * Measures the ranges the dashboard asks for most, for one connection.
   *
   * Called by the daily sync rather than by a request, which is the arrangement
   * that keeps the read path free of provider calls: by the time somebody opens
   * the dashboard, the six presets are already in the cache and the answer is a
   * single indexed lookup.
   *
   * Takes a credential rather than a scope, like the insights sync's own segment
   * entry point and for the same reason: a run resolves once, and a method that
   * could resolve its own credential would be a second door into a boundary that
   * exists to have exactly one.
   *
   * **A failed preset never fails the pass.** Each is an independent measurement
   * of an independent range, so one range Meta refused says nothing about the
   * other five — and the number this exists to produce is one a dashboard can
   * live without. The failure is described in the summary instead, which is what
   * makes it visible without making it fatal.
   */
  async prewarm(input: {
    credential: ResolvedAdCredential;
    now?: Date;
  }): Promise<SocialAdReachPrewarmSummary> {
    const startedAt = new Date();
    const { credential } = input;
    const today = currentDayIn(credential.timezone, input.now ?? startedAt);

    const outcomes: SocialAdReachPresetOutcome[] = [];
    let apiCalls = 0;

    for (const window of resolveReachPresets(today)) {
      try {
        const cached = await this.findCached(credential, window);

        if (cached && !cached.isPartial) {
          outcomes.push({
            preset: window.preset,
            since: window.since,
            until: window.until,
            status: 'cached',
            reach: cached.reach,
            isPartial: false,
          });

          continue;
        }

        const measured = await this.measure({ credential, window, today });

        apiCalls += measured.apiCalls;

        outcomes.push({
          preset: window.preset,
          since: window.since,
          until: window.until,
          status: 'measured',
          reach: measured.reach,
          isPartial: measured.isPartial,
        });
      } catch (error) {
        const failure = describeSocialAdSyncFailure(error);

        outcomes.push({
          preset: window.preset,
          since: window.since,
          until: window.until,
          status: 'failed',
          reach: null,
          isPartial: isPartialReachWindow(window, today),
          code: failure.code,
          message: failure.message,
        });
      }
    }

    const finishedAt = new Date();
    const summary: SocialAdReachPrewarmSummary = {
      connectionId: credential.connectionId,
      today,
      accountTimezone: credential.timezone,
      presets: outcomes,
      measured: outcomes.filter((one) => one.status === 'measured').length,
      cached: outcomes.filter((one) => one.status === 'cached').length,
      failed: outcomes.filter((one) => one.status === 'failed').length,
      apiCalls,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
    };

    // The summary was built to be safe to show, so there is nothing here a
    // response would not also carry.
    this.logger.log(
      `Meta Ads period reach prewarmed: ${JSON.stringify({
        connectionId: summary.connectionId,
        today: summary.today,
        measured: summary.measured,
        cached: summary.cached,
        failed: summary.failed,
        apiCalls: summary.apiCalls,
        durationMs: summary.durationMs,
      })}`,
    );

    return summary;
  }

  /**
   * Asks Meta for one range and stores the answer.
   *
   * `truncated` is fatal rather than tolerated. A period read asks for one row;
   * a second page means Meta answered a different question than the one asked,
   * and taking the first row of an unexpected shape is how a campaign's reach
   * ends up stored as an account's.
   *
   * The partial flag is computed from the window against the account's own
   * today, once, and stamped on the row — not re-derived on read. A row measured
   * yesterday for "yesterday through today" was partial *when it was taken*, and
   * that is the fact the re-measure rule needs; whether the range happens to look
   * closed now is a different statement, and the next pass will settle it by
   * measuring again.
   */
  private async measure(input: {
    credential: ResolvedAdCredential;
    window: SocialAdReachPeriodWindow;
    today: string;
  }): Promise<NormalizedAdReachPeriod & { apiCalls: number }> {
    const { credential, window } = input;

    const measurement = await this.reader.measure({ credential, window });

    if (measurement.truncated) {
      throw new Error(
        'Meta Ads period reach read returned more rows than a period read has.',
      );
    }

    const row: NormalizedAdReachPeriod = {
      tenantId: credential.tenantId,
      workspaceId: credential.workspaceId,
      agencyClientId: credential.agencyClientId,
      connectionId: credential.connectionId,
      provider: credential.provider,
      entityLevel: MEASUREMENT_LEVEL,
      entityExternalId: credential.externalAccountId,
      periodSince: window.since,
      periodUntil: window.until,
      // The connection's stored timezone, which the resolver already refused to
      // default: the range's day boundaries are only meaningful in it.
      accountTimezone: credential.timezone,
      reach: measurement.reach,
      isPartial: isPartialReachWindow(window, input.today),
      measuredAt: new Date(),
    };

    await this.upsert(row);

    return { ...row, apiCalls: measurement.apiCalls };
  }

  /**
   * Stores one measurement, replacing a partial one in place.
   *
   * An upsert rather than an insert, because re-measuring a moving range must
   * change the number rather than accumulate rows: a second row for the same
   * range would make the cache ambiguous, and any lookup that had to choose
   * between two rows would eventually choose by `created_at` and report the
   * older subtotal.
   */
  private async upsert(row: NormalizedAdReachPeriod): Promise<void> {
    await this.reachRepository
      .createQueryBuilder()
      .insert()
      .into(SocialAdReachPeriodEntity)
      .values([
        {
          tenantId: row.tenantId,
          workspaceId: row.workspaceId,
          agencyClientId: row.agencyClientId,
          connectionId: row.connectionId,
          provider: row.provider,
          entityLevel: row.entityLevel,
          entityExternalId: row.entityExternalId,
          periodSince: row.periodSince,
          periodUntil: row.periodUntil,
          accountTimezone: row.accountTimezone,
          reach: row.reach,
          isPartial: row.isPartial,
          measuredAt: row.measuredAt,
        },
      ] as QueryDeepPartialEntity<SocialAdReachPeriodEntity>[])
      .orUpdate(REFRESHED_REACH_COLUMNS, REACH_IDENTITY_COLUMNS)
      // Without this TypeORM reconciles the returned row back onto the value
      // object, which buys nothing for a write whose result is not read.
      .updateEntity(false)
      .execute();
  }

  /**
   * The stored measurement of this exact range.
   *
   * Equality on both endpoints, exactly as the read service does it — see the
   * note there. A range scan would return a nested range's number under the
   * requested range's label, which is smaller than the truth and undetectable by
   * anybody reading the dashboard.
   */
  private async findCached(
    credential: ResolvedAdCredential,
    window: SocialAdReachPeriodWindow,
  ) {
    return this.reachRepository.findOne({
      where: {
        tenantId: credential.tenantId,
        workspaceId: credential.workspaceId,
        connectionId: credential.connectionId,
        entityLevel: MEASUREMENT_LEVEL,
        entityExternalId: credential.externalAccountId,
        periodSince: window.since,
        periodUntil: window.until,
      },
      select: ['reach', 'measuredAt', 'isPartial'],
    });
  }
}
