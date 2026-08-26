import { Injectable, Logger } from '@nestjs/common';
import {
  SocialAdCredentialResolver,
  type SocialAdCredentialScope,
} from '../credentials/social-ad-credential.resolver';
import type { SocialAdInsightsLevel } from '../sync/meta-ads-insights.contract';
import {
  assertClosedInsightsWindow,
  parseInsightsWindow,
} from '../sync/insights-window';
import { SocialAdInsightsTruncatedError } from '../sync/social-ad-insights.error';
import { describeSocialAdSyncFailure } from '../sync/social-ad-sync.http-error';
import { MetaAdsInsightsReaderService } from './meta-ads-insights-reader.service';
import { SocialAdMetricsWriterService } from './social-ad-metrics-writer.service';

/**
 * The levels this slice ingests, in order.
 *
 * Fixed internally rather than accepted from the request. Ad set and ad
 * insights multiply the row count by roughly the number of objects at that
 * level, and letting a caller ask for them would ship the volume decision
 * before anyone has measured it. Account first because it is the cheapest read
 * and the one whose totals every later level is checked against.
 */
const INGEST_LEVELS: readonly SocialAdInsightsLevel[] = ['account', 'campaign'];

export type SyncAdInsightsInput = SocialAdCredentialScope & {
  connectionId: string;
  since: unknown;
  until: unknown;
};

export type SocialAdInsightsLevelSummary = {
  level: SocialAdInsightsLevel;
  status: 'completed' | 'failed';
  /** Daily rows the provider returned and this pipeline could read. */
  read: number;
  written: number;
  /** Rows dropped as unreadable. Normally zero. */
  skipped: number;
  /** Present only on a failed level: a stable code and a fixed message. */
  code?: string;
  message?: string;
};

/**
 * The result of a manual ingest — everything a caller may see.
 *
 * Assembled field by field. No credential, no payload, no provider error text
 * that has not been through `sanitizeMetaErrorMessage`.
 */
export type SocialAdInsightsSyncSummary = {
  connectionId: string;
  provider: string;
  externalAccountId: string;
  since: string;
  until: string;
  days: number;
  source: string;
  attributionSetting: string;
  accountTimezone: string;
  currency: string | null;
  /**
   * `partial` when at least one level failed *after* another had already
   * written facts. It is a statement about the run, and deliberately not about
   * the rows: `is_partial` on a fact describes whether that day was still open
   * when it was collected, which a failure at another level does not change.
   */
  status: 'completed' | 'partial';
  levels: SocialAdInsightsLevelSummary[];
  rowsWritten: number;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
};

/**
 * Manual, synchronous ingest of Meta Ads Insights into
 * `social_ad_metrics_daily`.
 *
 * Synchronous for the same reason the hierarchy sync is: `social_ad_sync_runs`
 * exists and nothing drains it yet, so enqueueing would turn "ingest now" into
 * a button that silently does nothing. Until S2.5 builds the worker, the honest
 * shape is a request that returns what it wrote.
 *
 * The credential is resolved once, here, and handed to the reader. That is the
 * whole of this pipeline's knowledge about authorization — whether the token
 * came from an encrypted column or from server configuration is settled inside
 * `SocialAdCredentialResolver` and is invisible everywhere downstream.
 */
@Injectable()
export class SocialAdInsightsSyncService {
  private readonly logger = new Logger(SocialAdInsightsSyncService.name);

  constructor(
    private readonly credentialResolver: SocialAdCredentialResolver,
    private readonly reader: MetaAdsInsightsReaderService,
    private readonly writer: SocialAdMetricsWriterService,
  ) {}

  async syncInsights(
    input: SyncAdInsightsInput,
  ): Promise<SocialAdInsightsSyncSummary> {
    const startedAt = new Date();

    // Before the credential: an unusable window is the caller's mistake, and
    // answering it costs no provider quota and reveals nothing about whether
    // the connection exists.
    const window = parseInsightsWindow({
      since: input.since,
      until: input.until,
    });

    // Scope is part of the lookup, not a check afterwards: a connection from
    // another tenant, workspace or managed client is simply not found, and the
    // caller never learns whether the id exists.
    const credential = await this.credentialResolver.resolve({
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      agencyClientId: input.agencyClientId,
      connectionId: input.connectionId,
    });

    /**
     * Checked here, after the credential, for two reasons.
     *
     * The boundary needs the ad account's timezone, which only the resolved
     * connection carries. And answering it before the scoped lookup would make
     * the endpoint an oracle: a caller could learn a connection's timezone — and
     * that it exists at all — by watching which refusal comes back for a
     * connection in somebody else's tenant.
     */
    assertClosedInsightsWindow(window, credential.timezone);

    /**
     * One instant for the whole run, stamped on every row as `synced_at`.
     *
     * It is the answer to "how fresh is this number", and taking it once means
     * every fact from one ingest carries the same answer regardless of which
     * level wrote it or how long the walk took.
     */
    const syncedAt = new Date();
    const levels: SocialAdInsightsLevelSummary[] = [];
    let rowsWritten = 0;

    for (const level of INGEST_LEVELS) {
      try {
        const page = await this.reader.read({
          credential,
          level,
          window,
          syncedAt,
        });

        // Checked before the write, so a truncated level stores nothing at all.
        // A half-written window is worse than an unwritten one: the days that
        // did land look complete, and nothing distinguishes the missing ones
        // from days with no delivery.
        if (page.truncated) {
          throw new SocialAdInsightsTruncatedError(level);
        }

        const written = await this.writer.upsert(page.rows);
        rowsWritten += written;

        levels.push({
          level,
          status: 'completed',
          read: page.rows.length,
          written,
          skipped: page.skipped,
        });
      } catch (error) {
        /**
         * Nothing stored yet: the failure is the whole outcome, so it travels
         * as an exception and the endpoint answers with a status that says what
         * went wrong.
         *
         * Facts already stored: it must not. Throwing here would report a
         * failed request for a run whose account-level days are now in the
         * table — and the obvious response to a failed request is to run it
         * again, which is a decision the caller should make knowing what
         * already landed. So the run stops, keeps what it wrote, and says
         * exactly which level did not finish.
         */
        if (!rowsWritten) throw error;

        const failure = describeSocialAdSyncFailure(error);

        levels.push({
          level,
          status: 'failed',
          read: 0,
          written: 0,
          skipped: 0,
          code: failure.code,
          message: failure.message,
        });

        break;
      }
    }

    const finishedAt = new Date();
    const summary: SocialAdInsightsSyncSummary = {
      connectionId: credential.connectionId,
      provider: credential.provider,
      externalAccountId: credential.externalAccountId,
      since: window.since,
      until: window.until,
      days: window.days,
      source: 'paid',
      attributionSetting: 'account_default',
      accountTimezone: credential.timezone,
      currency: credential.currency,
      status: levels.some((level) => level.status === 'failed')
        ? 'partial'
        : 'completed',
      levels,
      rowsWritten,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
    };

    // The summary is the log line: it was built to be safe to show, so there is
    // nothing here a response would not also carry.
    this.logger.log(
      `Meta Ads insights ingested: ${JSON.stringify({
        connectionId: summary.connectionId,
        since: summary.since,
        until: summary.until,
        rowsWritten: summary.rowsWritten,
        status: summary.status,
        durationMs: summary.durationMs,
      })}`,
    );

    return summary;
  }
}
