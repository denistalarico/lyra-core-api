import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import {
  LEADFLOW_SCOPE_SQL,
  leadFlowScopeParameters,
  type LeadFlowAnalyticsScope,
} from '../scope/leadflow-analytics-scope.sql';
import {
  resolveAttributionConsistency,
  type LeadFlowAttributionObservation,
  type LeadFlowAttributionOpportunity,
  type LeadFlowConversationAttribution,
} from './leadflow-attribution.port';

/**
 * The event type I3.1 appends on every observed qualification change.
 *
 * The same literal the fact adapter spells, for the same reason: the analytics
 * layer must not import a write path. `leadflow-attribution.boundary.spec`
 * asserts the two agree, so a rename fails a test rather than silently
 * returning null for every conversation.
 */
const QUALIFICATION_EVENT = 'qualification_status_changed';

/**
 * LeadFlow's side of the observed-attribution bridge.
 *
 * A second adapter beside `LeadFlowIntelligenceAdapter` rather than more
 * methods on it, and the split is by shape rather than by subject: that class
 * implements `IntelligenceFactSource`, whose every concept — grain, day
 * buckets, aggregable metric series — describes a *period*. Everything here is
 * about one conversation and has no window at all. Bolting individual lookups
 * onto a fact source would leave a class whose two halves obey different
 * contracts, and whose `fetch` signature suggests the wrong one.
 *
 * What it does share is the part that must never diverge: the client-binding
 * predicate comes from `LEADFLOW_SCOPE_SQL`, the same text the operational
 * screens and the fact adapter read. A second definition of "this client's
 * conversations" is how one screen attributes a conversation the next one
 * denies.
 */
@Injectable()
export class LeadFlowAttributionAdapter {
  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
  ) {}

  /**
   * Everything LeadFlow knows about one conversation's observed origin.
   *
   * Three reads rather than one join, deliberately. A conversation with three
   * observations and two qualification transitions would multiply into six rows
   * under a single join, and the de-duplication that follows is exactly where a
   * count silently doubles. They are issued together because none depends on
   * another's result.
   */
  async conversationAttribution(
    scope: LeadFlowAnalyticsScope,
    conversationId: string,
  ): Promise<LeadFlowConversationAttribution> {
    const [existsRows, observationRows, qualificationRows] = await Promise.all([
      this.conversationExists(scope, conversationId),
      this.readObservations(scope, conversationId),
      this.readFirstQualification(scope, conversationId),
    ]);

    const exists = existsRows.length > 0;

    /**
     * A conversation outside the scope reports as non-existent, with no
     * observations.
     *
     * Not an error, and deliberately indistinguishable from a conversation id
     * that never existed: telling a caller "this conversation exists but is not
     * yours" confirms the id, which is the shape cross-tenant enumeration
     * relies on.
     */
    if (!exists) {
      return {
        conversationId,
        exists: false,
        observations: [],
        distinctAdIds: [],
        consistency: 'none',
        firstObservedAt: null,
        lastObservedAt: null,
        firstQualifiedAt: null,
      };
    }

    const observations = observationRows.map(toObservation);
    const withAdId = observations.filter((row) => row.adId !== null);
    const distinctAdIds = [
      ...new Set(withAdId.map((row) => row.adId as string)),
    ].sort();

    return {
      conversationId,
      exists: true,
      observations,
      distinctAdIds,
      consistency: resolveAttributionConsistency(
        distinctAdIds,
        withAdId.length,
      ),
      // Ordered by `observed_at` in SQL, so the ends of the list are the ends
      // of the timeline. Provider time, not write time: a webhook replayed out
      // of order must not reorder history.
      firstObservedAt: observations[0]?.observedAt ?? null,
      lastObservedAt: observations[observations.length - 1]?.observedAt ?? null,
      firstQualifiedAt: qualificationRows[0]?.occurredAt ?? null,
    };
  }

  /**
   * Opportunities reached by an explicit `inbox_conversation_id` link.
   *
   * The only link this layer accepts. Matching on contact, phone, email or
   * same-day proximity would manufacture attribution out of coincidence — two
   * different people messaging the same business on the same afternoon are not
   * evidence of anything — and the result would still be labelled `observed`.
   *
   * Returns every match. A conversation can produce several opportunities, and
   * which one "counts" is a commercial decision this layer does not make.
   */
  async conversationOpportunities(
    scope: LeadFlowAnalyticsScope,
    conversationId: string,
  ): Promise<LeadFlowAttributionOpportunity[]> {
    const rows = await this.dataSource.query<OpportunityRow[]>(
      `
        /* leadflow-attribution:conversation-opportunities */
        SELECT opportunity.id::text            AS "opportunityId",
               opportunity.status              AS "status",
               opportunity.won_at              AS "wonAt",
               opportunity.value_amount::text  AS "valueAmount",
               opportunity.currency            AS "currency"
        FROM crm_opportunities opportunity
        WHERE opportunity.tenant_id = $1
          AND opportunity.workspace_id = $2
          AND opportunity.inbox_conversation_id = $5
          AND ${LEADFLOW_SCOPE_SQL.OPPORTUNITY}
        ORDER BY opportunity.created_at ASC, opportunity.id ASC
      `,
      [...leadFlowScopeParameters(scope), conversationId],
    );

    return rows.map((row) => ({
      opportunityId: row.opportunityId,
      status: row.status,
      // The canonical definition, identical to `sumOpportunitiesWon`: a status
      // of 'won' *and* a timestamp. A row marked won with no `won_at` is an
      // inconsistent write, and treating it as won here while the period
      // reports exclude it would make the two disagree.
      isWon: row.status === 'won' && row.wonAt !== null,
      wonAt: toIso(row.wonAt),
      valueAmount: row.valueAmount,
      currency: row.currency,
    }));
  }

  /**
   * Scope check and existence check in one, so neither can be forgotten.
   *
   * `LEFT JOIN inbox_channels` matches the operational predicate's shape: a
   * conversation with no channel belongs to the agency context, and an INNER
   * JOIN would silently drop exactly those.
   */
  private conversationExists(
    scope: LeadFlowAnalyticsScope,
    conversationId: string,
  ): Promise<Array<{ id: string }>> {
    return this.dataSource.query<Array<{ id: string }>>(
      `
        /* leadflow-attribution:conversation-in-scope */
        SELECT conversation.id::text AS "id"
        FROM inbox_conversations conversation
        LEFT JOIN inbox_channels channel
          ON channel.id = conversation.channel_id
         AND channel.tenant_id = conversation.tenant_id
         AND channel.workspace_id = conversation.workspace_id
         AND channel.deleted_at IS NULL
        WHERE conversation.tenant_id = $1
          AND conversation.workspace_id = $2
          AND conversation.id = $5
          AND ${LEADFLOW_SCOPE_SQL.CHANNEL}
        LIMIT 1
      `,
      [...leadFlowScopeParameters(scope), conversationId],
    );
  }

  /**
   * Every observation on the conversation, oldest first.
   *
   * Scoped through the conversation's channel rather than through the
   * observation's own `agency_client_id`. The two agree at write time, but the
   * frozen column is a record of what was true then, while this endpoint answers
   * "may this caller see this conversation" — a question about now. Using the
   * frozen value as an access check would let a channel re-pointed to another
   * client keep exposing its old rows.
   */
  private readObservations(
    scope: LeadFlowAnalyticsScope,
    conversationId: string,
  ): Promise<ObservationRow[]> {
    return this.dataSource.query<ObservationRow[]>(
      `
        /* leadflow-attribution:observations */
        SELECT observation.id::text              AS "observationId",
               observation.message_id::text      AS "messageId",
               observation.conversation_id::text AS "conversationId",
               observation.provider              AS "provider",
               observation.channel_type          AS "channelType",
               observation.ad_id                 AS "adId",
               observation.click_id              AS "clickId",
               observation.source_type           AS "sourceType",
               observation.observed_at           AS "observedAt"
        FROM inbox_attribution_observations observation
        INNER JOIN inbox_conversations conversation
          ON conversation.id = observation.conversation_id
         AND conversation.tenant_id = observation.tenant_id
         AND conversation.workspace_id = observation.workspace_id
        LEFT JOIN inbox_channels channel
          ON channel.id = conversation.channel_id
         AND channel.tenant_id = conversation.tenant_id
         AND channel.workspace_id = conversation.workspace_id
         AND channel.deleted_at IS NULL
        WHERE observation.tenant_id = $1
          AND observation.workspace_id = $2
          AND observation.conversation_id = $5
          AND ${LEADFLOW_SCOPE_SQL.CHANNEL}
        ORDER BY observation.observed_at ASC, observation.created_at ASC
      `,
      [...leadFlowScopeParameters(scope), conversationId],
    );
  }

  /**
   * The earliest recorded qualification of this conversation, across all time.
   *
   * Unwindowed on purpose — the question is "was this conversation ever
   * qualified, and when", not "was it qualified during some period". Ordered by
   * the provider-reported `occurredAt`, the same field I3.1's history reads.
   */
  private readFirstQualification(
    scope: LeadFlowAnalyticsScope,
    conversationId: string,
  ): Promise<Array<{ occurredAt: string }>> {
    return this.dataSource.query<Array<{ occurredAt: string }>>(
      `
        /* leadflow-attribution:first-qualification */
        SELECT event.payload->>'occurredAt' AS "occurredAt"
        FROM inbox_conversation_events event
        INNER JOIN inbox_conversations conversation
          ON conversation.id = event.conversation_id
         AND conversation.tenant_id = event.tenant_id
         AND conversation.workspace_id = event.workspace_id
        LEFT JOIN inbox_channels channel
          ON channel.id = conversation.channel_id
         AND channel.tenant_id = conversation.tenant_id
         AND channel.workspace_id = conversation.workspace_id
         AND channel.deleted_at IS NULL
        WHERE event.tenant_id = $1
          AND event.workspace_id = $2
          AND event.conversation_id = $5
          AND event.event_type = '${QUALIFICATION_EVENT}'
          AND event.payload->>'newStatus' = 'qualified'
          AND event.payload->>'occurredAt' IS NOT NULL
          AND ${LEADFLOW_SCOPE_SQL.CHANNEL}
        ORDER BY (event.payload->>'occurredAt')::timestamptz ASC,
                 event.created_at ASC
        LIMIT 1
      `,
      [...leadFlowScopeParameters(scope), conversationId],
    );
  }
}

type ObservationRow = {
  observationId: string;
  messageId: string;
  conversationId: string;
  provider: string;
  channelType: string;
  adId: string | null;
  clickId: string | null;
  sourceType: string | null;
  observedAt: Date | string;
};

type OpportunityRow = {
  opportunityId: string;
  status: string;
  wonAt: Date | string | null;
  valueAmount: string | null;
  currency: string | null;
};

function toObservation(row: ObservationRow): LeadFlowAttributionObservation {
  return {
    observationId: row.observationId,
    messageId: row.messageId,
    conversationId: row.conversationId,
    provider: row.provider,
    channelType: row.channelType,
    adId: row.adId,
    clickId: row.clickId,
    sourceType: row.sourceType,
    observedAt: toIso(row.observedAt) as string,
  };
}

/** The driver returns `timestamptz` as a Date; the contract is an ISO string. */
function toIso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
}
