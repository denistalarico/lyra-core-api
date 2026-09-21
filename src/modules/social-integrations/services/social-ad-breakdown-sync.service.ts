import { Injectable, Logger } from '@nestjs/common';
import type { ResolvedAdCredential } from '../credentials/resolved-ad-credential';
import {
  SocialAdCredentialResolver,
  type SocialAdCredentialScope,
} from '../credentials/social-ad-credential.resolver';
import type { SocialAdBreakdownKind } from '../entities/social-ad-breakdown-daily.entity';
import { BREAKDOWN_KINDS } from '../sync/meta-ads-breakdown.contract';
import type { SocialAdInsightsLevel } from '../sync/meta-ads-insights.contract';
import {
  assertClosedInsightsWindow,
  parseInsightsWindow,
  type InsightsWindow,
} from '../sync/insights-window';
import {
  SocialAdBreakdownDisabledError,
  SocialAdBreakdownTruncatedError,
} from '../sync/social-ad-breakdown.error';
import { describeSocialAdSyncFailure } from '../sync/social-ad-sync.http-error';
import { MetaAdsBreakdownReaderService } from './meta-ads-breakdown-reader.service';
import { SocialAdBreakdownConfigService } from './social-ad-breakdown-config.service';
import { SocialAdBreakdownWriterService } from './social-ad-breakdown-writer.service';

/**
 * The level breakdowns are ingested at.
 *
 * Account only, and this is the decision most worth defending in this slice.
 *
 * Every dimension multiplies a window's row count by its own size, and the
 * multiplication compounds with the level: one account × 90 days × 8 age/gender
 * cells is 720 rows, while 126 ad sets over the same window is 90 720 — for a
 * split nothing in the dashboard asks for. The charts Etapa 4 specifies
 * ("audiência por idade e gênero", "alcance por dispositivo", "gasto no Facebook
 * vs Instagram") are all account-level questions.
 *
 * It is a constant rather than a parameter for the same reason `INGEST_LEVELS`
 * is: the list is what a pass reports having covered, and a caller-supplied one
 * would produce coverage claims describing whatever that caller asked for. The
 * table itself carries `entity_level` and its unique key includes it, so adding
 * campaign level later is a change here and nowhere else.
 */
const BREAKDOWN_LEVEL: SocialAdInsightsLevel = 'account';

export type SyncAdBreakdownsInput = SocialAdCredentialScope & {
  connectionId: string;
  since: unknown;
  until: unknown;
};

export type SocialAdBreakdownKindSummary = {
  kind: SocialAdBreakdownKind;
  status: 'completed' | 'failed';
  /** Daily rows the provider returned and this pipeline could read. */
  read: number;
  written: number;
  /** Rows dropped as unreadable — most often an unrecognizable bucket key. */
  skipped: number;
  apiCalls: number;
  /** Present only on a failed dimension: a stable code and a fixed message. */
  code?: string;
  message?: string;
};

/**
 * The result of a breakdown ingest — everything a caller may see.
 *
 * Assembled field by field. No credential, no payload, no provider error text
 * that has not been through `sanitizeMetaErrorMessage`.
 */
export type SocialAdBreakdownSyncSummary = {
  connectionId: string;
  provider: string;
  externalAccountId: string;
  since: string;
  until: string;
  days: number;
  entityLevel: SocialAdInsightsLevel;
  accountTimezone: string;
  currency: string | null;
  /**
   * `partial` when at least one dimension failed after another had already
   * written rows. A statement about the run, not about the rows: `is_partial`
   * on a fact describes whether that day was still open when it was collected,
   * which a failure on another dimension does not change.
   */
  status: 'completed' | 'partial';
  kinds: SocialAdBreakdownKindSummary[];
  rowsWritten: number;
  apiCalls: number;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
};

/**
 * Manual, synchronous ingest of Meta Ads breakdowns into
 * `social_ad_breakdown_daily`.
 *
 * Synchronous for the reason the insights sync documents: enqueueing into a
 * queue nothing drains for this work would turn "ingest now" into a button that
 * silently does nothing. It is deliberately **not** registered as a
 * `SocialAdSyncSegment` — that union is the run log's stored contract, which
 * S2.5's worker and S2.9's retention both read, and widening it would change
 * what every historical run's recorded coverage means. Breakdowns get their own
 * entry point until something needs them on the queue.
 *
 * The credential is resolved once, here, and handed to the reader — the whole of
 * this pipeline's knowledge about authorization.
 */
@Injectable()
export class SocialAdBreakdownSyncService {
  private readonly logger = new Logger(SocialAdBreakdownSyncService.name);

  constructor(
    private readonly credentialResolver: SocialAdCredentialResolver,
    private readonly config: SocialAdBreakdownConfigService,
    private readonly reader: MetaAdsBreakdownReaderService,
    private readonly writer: SocialAdBreakdownWriterService,
  ) {}

  async syncBreakdowns(
    input: SyncAdBreakdownsInput,
  ): Promise<SocialAdBreakdownSyncSummary> {
    const startedAt = new Date();

    /**
     * The gate, checked before anything else.
     *
     * Ahead of the window parse and the credential lookup because it is the one
     * refusal that costs nothing to answer and reveals nothing: it is a property
     * of the deployment, not of the request or the connection.
     */
    if (!this.config.enabled) throw new SocialAdBreakdownDisabledError();

    // An unusable window is the caller's mistake, and answering it costs no
    // provider quota and reveals nothing about whether the connection exists.
    const window = parseInsightsWindow({
      since: input.since,
      until: input.until,
    });

    // Scope is part of the lookup, not a check afterwards: a connection from
    // another tenant, workspace or managed client is simply not found.
    const credential = await this.credentialResolver.resolve({
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      agencyClientId: input.agencyClientId,
      companyContextId: input.companyContextId ?? null,
      connectionId: input.connectionId,
    });

    // After the credential, which is what carries the ad account's timezone —
    // and answering it before the scoped lookup would make the endpoint an
    // oracle for connections in somebody else's tenant.
    assertClosedInsightsWindow(window, credential.timezone);

    /** One instant for the whole pass, stamped on every row as `synced_at`. */
    const syncedAt = new Date();
    const kinds: SocialAdBreakdownKindSummary[] = [];
    let rowsWritten = 0;

    for (const kind of BREAKDOWN_KINDS) {
      try {
        const summary = await this.ingestKind({
          credential,
          kind,
          window,
          // The entry point accepts closed windows only — the assertion above is
          // what makes this a fact rather than an assumption.
          isPartial: false,
          syncedAt,
        });

        rowsWritten += summary.written;
        kinds.push(summary);
      } catch (error) {
        /**
         * Nothing stored yet: the failure is the whole outcome, so it travels as
         * an exception.
         *
         * Rows already stored: it must not. Throwing would report a failed
         * request for a pass whose age/gender rows are now in the table — and
         * the obvious response to a failed request is to run it again, which is
         * a decision the caller should make knowing what already landed.
         */
        if (!rowsWritten) throw error;

        const failure = describeSocialAdSyncFailure(error);

        kinds.push({
          kind,
          status: 'failed',
          read: 0,
          written: 0,
          skipped: 0,
          // Unknown: the read may have spent requests before it failed, and the
          // page that would have reported them never returned. A zero here
          // understates rather than invents.
          apiCalls: 0,
          code: failure.code,
          message: failure.message,
        });

        break;
      }
    }

    const finishedAt = new Date();
    const summary: SocialAdBreakdownSyncSummary = {
      connectionId: credential.connectionId,
      provider: credential.provider,
      externalAccountId: credential.externalAccountId,
      since: window.since,
      until: window.until,
      days: window.days,
      entityLevel: BREAKDOWN_LEVEL,
      accountTimezone: credential.timezone,
      currency: credential.currency,
      status: kinds.some((kind) => kind.status === 'failed')
        ? 'partial'
        : 'completed',
      kinds,
      rowsWritten,
      apiCalls: kinds.reduce((total, kind) => total + kind.apiCalls, 0),
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
    };

    // The summary is the log line: it was built to be safe to show, so there is
    // nothing here a response would not also carry.
    this.logger.log(
      `Meta Ads breakdowns ingested: ${JSON.stringify({
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

  /**
   * One dimension of a closed window: read, refuse if truncated, write.
   *
   * Takes a credential rather than a scope, like the insights sync's own segment
   * entry point and for the same reason: a run resolves once, and a method that
   * could resolve its own credential would be a second door into a boundary that
   * exists to have exactly one.
   *
   * Throws on failure. There is no partial dimension — it either wrote its
   * distribution or did not — and what a failure means for the *pass* belongs to
   * the caller, which is the only one that knows what already landed.
   */
  async ingestKind(input: {
    credential: ResolvedAdCredential;
    kind: SocialAdBreakdownKind;
    window: InsightsWindow;
    isPartial: boolean;
    syncedAt: Date;
  }): Promise<SocialAdBreakdownKindSummary> {
    const page = await this.reader.read({
      credential: input.credential,
      level: BREAKDOWN_LEVEL,
      kind: input.kind,
      window: input.window,
      isPartial: input.isPartial,
      syncedAt: input.syncedAt,
    });

    // Checked before the write, so a truncated dimension stores nothing at all.
    // A half-written distribution is worse than an unwritten one: the buckets
    // that did land look complete, and a chart drawn from them still sums to
    // 100% of a total that is missing its tail.
    if (page.truncated) {
      throw new SocialAdBreakdownTruncatedError(BREAKDOWN_LEVEL, input.kind);
    }

    const written = await this.writer.upsert(page.rows);

    return {
      kind: input.kind,
      status: 'completed',
      read: page.rows.length,
      written,
      skipped: page.skipped,
      apiCalls: page.apiCalls,
    };
  }
}
