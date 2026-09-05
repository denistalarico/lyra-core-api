import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import {
  LEADFLOW_SCOPE_SQL,
  leadFlowScopeParameters,
  type LeadFlowAnalyticsScope,
} from '../scope/leadflow-analytics-scope.sql';
import {
  LEADFLOW_SUPPORTED_ATTRIBUTION_CHANNEL,
  LEADFLOW_SUPPORTED_ATTRIBUTION_PROVIDER,
  type LeadFlowCohortConversation,
  type LeadFlowCohortEligibility,
  type LeadFlowCohortOpportunity,
} from './leadflow-attribution-cohort.port';

/** The event type I3.1 appends on every observed qualification change. */
const QUALIFICATION_EVENT = 'qualification_status_changed';

/**
 * The window, as absolute instants.
 *
 * The cohort is selected on `observed_at`, which is a provider-reported instant,
 * so the window has to become instants too. It is widened in the ad account's
 * own zone by the caller — the same zone I3.5 cuts its days in — and arrives
 * here already resolved, because a second place deciding "when does 2026-09-01
 * start" is how two endpoints disagree about which day a conversation belongs
 * to.
 */
export type LeadFlowCohortWindow = {
  /** Inclusive lower bound. */
  fromInstant: string;
  /** Exclusive upper bound — the instant the day after `until` begins. */
  untilInstant: string;
};

/**
 * LeadFlow's side of the observed-attribution *cohort*.
 *
 * A third adapter beside the fact source and the individual attribution port,
 * and split from both for the reason each split was made: `LeadFlowIntelligence`
 * implements `IntelligenceFactSource` and answers in day buckets;
 * `LeadFlowAttributionAdapter` answers about one conversation with no window at
 * all. This answers about a *set* of conversations selected by a window, which
 * is neither shape.
 *
 * What all three share, and must: the client-binding predicate comes from
 * `LEADFLOW_SCOPE_SQL`. A cohort that decided "this client's conversations"
 * differently from the individual endpoint would attribute in aggregate what it
 * denies one row at a time.
 */
@Injectable()
export class LeadFlowAttributionCohortAdapter {
  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
  ) {}

  /**
   * Conversations whose **first ad-carrying observation** falls in the window.
   *
   * ## Entry-cohort selection, in one pass
   *
   * The inner aggregate reduces every observation to one row per conversation
   * before the window is applied, so a conversation is placed by the first ad it
   * ever carried rather than by whichever observation happens to fall inside the
   * range. The difference is not cosmetic: a contact who clicked in August and
   * again in September belongs to August's cohort, and filtering observations
   * first would place the same conversation in both windows and double it in
   * any month-over-month comparison.
   *
   * `firstQualifiedAt` is joined unclipped for the same reason §9 gives —
   * outcomes are followed past `to`.
   */
  async cohortConversations(
    scope: LeadFlowAnalyticsScope,
    window: LeadFlowCohortWindow,
  ): Promise<LeadFlowCohortConversation[]> {
    const rows = await this.dataSource.query<CohortConversationRow[]>(
      `
        /* leadflow-attribution-cohort:conversations */
        WITH entered AS (
          SELECT observation.conversation_id                    AS conversation_id,
                 MIN(observation.observed_at)                   AS entered_at,
                 COUNT(*)                                       AS observations_count,
                 ARRAY_AGG(DISTINCT observation.ad_id)          AS ad_ids,
                 -- I4.3: the instants themselves, not just their count. Each is
                 -- a question for the destination timeline; DISTINCT because two
                 -- observations at the same instant resolve to the same answer.
                 ARRAY_AGG(DISTINCT observation.observed_at)    AS observed_ats,
                 MIN(observation.channel_type)                  AS channel_type,
                 MIN(observation.provider)                      AS provider
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
            AND observation.ad_id IS NOT NULL
            AND ${LEADFLOW_SCOPE_SQL.CHANNEL}
          GROUP BY observation.conversation_id
        )
        SELECT entered.conversation_id::text AS "conversationId",
               entered.entered_at            AS "enteredAt",
               entered.observations_count    AS "observationsCount",
               entered.ad_ids                AS "adIds",
               entered.observed_ats          AS "observedAts",
               entered.channel_type          AS "channelType",
               entered.provider              AS "provider",
               qualification.occurred_at     AS "firstQualifiedAt"
        FROM entered
        LEFT JOIN LATERAL (
          SELECT (event.payload->>'occurredAt')::timestamptz AS occurred_at
          FROM inbox_conversation_events event
          WHERE event.tenant_id = $1
            AND event.workspace_id = $2
            AND event.conversation_id = entered.conversation_id
            AND event.event_type = '${QUALIFICATION_EVENT}'
            AND event.payload->>'newStatus' = 'qualified'
            AND event.payload->>'occurredAt' IS NOT NULL
          ORDER BY (event.payload->>'occurredAt')::timestamptz ASC,
                   event.created_at ASC
          LIMIT 1
        ) qualification ON TRUE
        WHERE entered.entered_at >= $5
          AND entered.entered_at < $6
        ORDER BY entered.entered_at ASC, entered.conversation_id ASC
      `,
      [
        ...leadFlowScopeParameters(scope),
        window.fromInstant,
        window.untilInstant,
      ],
    );

    return rows.map((row) => ({
      conversationId: row.conversationId,
      enteredAt: toIso(row.enteredAt) as string,
      // `ARRAY_AGG(DISTINCT ...)` over a `WHERE ad_id IS NOT NULL` scan cannot
      // produce a null element, but the driver types it nullable and a single
      // stray null would become the string "null" in a group key.
      distinctAdIds: (row.adIds ?? [])
        .filter((value): value is string => value !== null)
        .sort(),
      observationsCount: Number(row.observationsCount),
      // Ascending, so the projector's "latest reading wins" tie-break reads the
      // freshest evidence without re-sorting. `ARRAY_AGG(DISTINCT ...)` already
      // orders by the aggregated value, but the sort is restated rather than
      // relied upon: the ordering is a documented consequence of DISTINCT, not
      // a guarantee of ARRAY_AGG, and the projector's semantics depend on it.
      attributionInstants: (row.observedAts ?? [])
        .filter((value): value is Date | string => value !== null)
        .map((value) => toIso(value) as string)
        .sort(),
      channelType: row.channelType,
      provider: row.provider,
      firstQualifiedAt: toIso(row.firstQualifiedAt),
    }));
  }

  /**
   * Opportunities explicitly linked to any conversation in the cohort.
   *
   * `inbox_conversation_id = ANY($5)` rather than a join back to the selection:
   * the cohort is already resolved in memory and re-deriving it inside this
   * query would mean two copies of the entry rule that could drift apart.
   *
   * Unwindowed on purpose — §10. An opportunity created after `to` still
   * belongs to the conversation that entered before it, and clipping here would
   * make every recent cohort look like it produced nothing.
   */
  async cohortOpportunities(
    scope: LeadFlowAnalyticsScope,
    conversationIds: readonly string[],
  ): Promise<LeadFlowCohortOpportunity[]> {
    if (!conversationIds.length) return [];

    const rows = await this.dataSource.query<CohortOpportunityRow[]>(
      `
        /* leadflow-attribution-cohort:opportunities */
        SELECT opportunity.inbox_conversation_id::text AS "conversationId",
               opportunity.id::text                    AS "opportunityId",
               opportunity.status                      AS "status",
               opportunity.won_at                      AS "wonAt",
               opportunity.value_amount::text          AS "valueAmount",
               opportunity.currency                    AS "currency"
        FROM crm_opportunities opportunity
        WHERE opportunity.tenant_id = $1
          AND opportunity.workspace_id = $2
          AND opportunity.inbox_conversation_id = ANY($5::uuid[])
          AND ${LEADFLOW_SCOPE_SQL.OPPORTUNITY}
        ORDER BY opportunity.created_at ASC, opportunity.id ASC
      `,
      [...leadFlowScopeParameters(scope), [...conversationIds]],
    );

    return rows.map((row) => ({
      conversationId: row.conversationId,
      opportunityId: row.opportunityId,
      status: row.status,
      // The canonical pair, identical to `sumOpportunitiesWon` and to the
      // individual endpoint. A third definition here is how an aggregate ends
      // up disagreeing with the rows it aggregates.
      isWon: row.status === 'won' && row.wonAt !== null,
      wonAt: toIso(row.wonAt),
      valueAmount: row.valueAmount,
      currency: row.currency,
    }));
  }

  /**
   * The honest denominator: conversations that *could* have carried a referral.
   *
   * ## Why `created_at` and not the observation instant
   *
   * The numerator is selected on when an ad was observed; the denominator has
   * no observations by definition, so it needs a timestamp every conversation
   * has. `created_at` is when the thread began, which is the closest analogue
   * to "entered the window" — and `last_message_at` would let a two-year-old
   * conversation re-enter every window it happens to receive a message in,
   * inflating the denominator with threads that never had a chance to be
   * attributed inside it.
   *
   * ## Why the channel type comes from the channel and not the observation
   *
   * An unattributed conversation has no observation to read a type from. The
   * channel's own `type` is the only source available for both halves of the
   * ratio, and using two different sources for numerator and denominator is how
   * a coverage figure exceeds 100%.
   */
  async cohortEligibility(
    scope: LeadFlowAnalyticsScope,
    window: LeadFlowCohortWindow,
  ): Promise<LeadFlowCohortEligibility> {
    const rows = await this.dataSource.query<EligibilityRow[]>(
      `
        /* leadflow-attribution-cohort:eligibility */
        SELECT COUNT(*) FILTER (
                 WHERE channel.type = $7 AND channel.provider = $8
               ) AS "eligible",
               COUNT(*) FILTER (
                 WHERE channel.type IS DISTINCT FROM $7
                    OR channel.provider IS DISTINCT FROM $8
               ) AS "unsupported"
        FROM inbox_conversations conversation
        LEFT JOIN inbox_channels channel
          ON channel.id = conversation.channel_id
         AND channel.tenant_id = conversation.tenant_id
         AND channel.workspace_id = conversation.workspace_id
         AND channel.deleted_at IS NULL
        WHERE conversation.tenant_id = $1
          AND conversation.workspace_id = $2
          AND conversation.created_at >= $5
          AND conversation.created_at < $6
          AND ${LEADFLOW_SCOPE_SQL.CHANNEL}
      `,
      [
        ...leadFlowScopeParameters(scope),
        window.fromInstant,
        window.untilInstant,
        LEADFLOW_SUPPORTED_ATTRIBUTION_CHANNEL,
        LEADFLOW_SUPPORTED_ATTRIBUTION_PROVIDER,
      ],
    );

    const row = rows[0];

    return {
      eligibleConversations: Number(row?.eligible ?? 0),
      unsupportedConversations: Number(row?.unsupported ?? 0),
    };
  }
}

type CohortConversationRow = {
  conversationId: string;
  enteredAt: Date | string;
  observationsCount: string | number;
  adIds: Array<string | null> | null;
  observedAts: Array<Date | string | null> | null;
  channelType: string;
  provider: string;
  firstQualifiedAt: Date | string | null;
};

type CohortOpportunityRow = {
  conversationId: string;
  opportunityId: string;
  status: string;
  wonAt: Date | string | null;
  valueAmount: string | null;
  currency: string | null;
};

type EligibilityRow = { eligible: string; unsupported: string };

/** The driver returns `timestamptz` as a Date; the contract is an ISO string. */
function toIso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
}
