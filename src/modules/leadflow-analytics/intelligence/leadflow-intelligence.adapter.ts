import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import {
  countWindowDays,
  listWindowDays,
  type IntelligenceDomain,
  type IntelligenceFact,
  type IntelligenceFactQuery,
  type IntelligenceFactSet,
  type IntelligenceFactSource,
  type IntelligenceGrain,
  type IntelligenceMetricDescriptor,
  type IntelligenceRatioDescriptor,
  type IntelligenceScope,
  type IntelligenceWindow,
} from '../../../common/intelligence';
import {
  LEADFLOW_SCOPE_SQL,
  leadFlowScopeParameters,
} from '../scope/leadflow-analytics-scope.sql';
import {
  LEADFLOW_COMMERCIAL_METRICS,
  LEADFLOW_CONVERSATION_METRICS,
  LEADFLOW_QUALIFICATION_METRICS,
} from './leadflow-metrics';

/**
 * The event type I3.1 appends on every observed qualification change.
 *
 * Spelled here rather than imported from the Inbox recorder to keep the
 * analytics layer from depending on a write path — but it is the same literal,
 * and `leadflow-intelligence.boundary.spec` asserts the two agree so a rename
 * on either side fails a test instead of silently zeroing the metric.
 */
const QUALIFICATION_EVENT = 'qualification_status_changed';

/**
 * What this adapter can say about qualification history, travelling with facts.
 *
 * `qualified_leads` is the only metric here that cannot speak for all time: the
 * evidence begins when I3.1 was deployed, and a window that predates it holds
 * conversations that were qualified with no transition to prove it. A bare `0`
 * would be indistinguishable from "nobody qualified", so the count is always
 * accompanied by where history actually starts.
 */
export type LeadFlowQualificationCoverage = {
  /**
   * The earliest qualification transition this scope has ever recorded, or null
   * when it has none at all.
   *
   * Derived from the data rather than from a deploy constant: a hardcoded date
   * would be wrong for every environment that deployed on a different day, and
   * would keep claiming coverage after a database restore that predates it.
   */
  historyStartsAt: string | null;
  /**
   * True when the requested window opens before the evidence does.
   *
   * The flag the consumer branches on. When set, the count is a floor — real
   * qualifications happened that this system cannot see — and no rate derived
   * from it is trustworthy.
   */
  windowPrecedesHistory: boolean;
};

/** The three conversation counts, for one channel. */
export type LeadFlowChannelCounts = {
  conversationsReceived: string;
  inboundMessages: string;
  qualifiedLeads: string;
};

/**
 * Conversation counts split by `inbox_channels.type`.
 *
 * Keyed by the column's own value, `null` for a conversation with no channel.
 * Canonicalising the key here would put a second copy of the channel vocabulary
 * in this file; `acquisition-channel.ts` owns that mapping and this reports what
 * the database holds.
 */
export type LeadFlowChannelBreakdown = {
  channels: Map<string | null, LeadFlowChannelCounts>;
};

/**
 * What the per-channel counts are derived from, named by the domain that owns
 * the tables.
 *
 * Exported for the same reason Social exports its own: the cross-domain module
 * must publish provenance without naming another domain's tables in its source,
 * which its boundary spec forbids — a module that spells `inbox_conversations`
 * is one edit from querying it and making a second copy of the client predicate.
 */
export const LEADFLOW_CHANNEL_PROVENANCE =
  'inbox_conversations, inbox_messages, inbox_conversation_events';

/**
 * LeadFlow's own numbers, through the same port paid media uses.
 *
 * The purpose of this adapter is to **prove the abstraction**: if the contract
 * only ever had one implementation it would be a description of Social Ads
 * wearing a general name, and the first genuinely different domain would break
 * it. LeadFlow is that different domain in every way that matters — its facts
 * are instants rather than calendar days, its client scoping is a JSONB key
 * rather than a column, and its data is written transactionally rather than
 * synced. Three of the contract's decisions exist because of it:
 * `IntelligenceWindow` carrying date-strings, `IntelligenceFreshness.mode`
 * admitting `canonical`, and `businessMode` being nullable.
 *
 * It replaces nothing. `LeadFlowAnalyticsService` and
 * `LeadFlowOperationalAnalyticsService` are untouched and remain what the
 * LeadFlow screens read — they answer a different question (rich, filtered,
 * per-agent, per-recipe breakdowns for a UI) and this answers a narrow one
 * (comparable counts under a shared shape). Refactoring them into this port
 * would have been a rewrite of a working analytics layer to serve a contract
 * that has not yet earned it.
 *
 * ## Why it aggregates in SQL
 *
 * The existing services load the underlying rows — up to 50,000 messages and
 * 25,000 score snapshots — and project them in memory, which is right for a
 * screen that slices the same facts eight ways from one load. A fact source
 * needs five counts, so it counts them in Postgres. Loading fifty thousand rows
 * to return five numbers would make a 90-day window cost more than the whole
 * dashboard it is meant to be a lightweight alternative to.
 *
 * ## Scope
 *
 * The client-binding predicates come from `LEADFLOW_SCOPE_SQL`, which this
 * adapter and `LeadFlowOperationalAnalyticsService` both read. They were
 * extracted rather than copied: the operational service already carried five
 * inline duplicates of the same JSONB conditions, and adding a sixth here would
 * have made "the two screens disagree about which client a row belongs to" a
 * plausible bug with no single place to fix it.
 *
 * That sharing is the whole safety argument. A fact source that interpreted
 * scope even slightly differently from the screens would report different
 * numbers for the same question — worse than reporting none — and now it cannot,
 * because there is one definition and both callers read it.
 */
@Injectable()
export class LeadFlowIntelligenceAdapter implements IntelligenceFactSource {
  /**
   * `conversation`, though it also reports commercial counts.
   *
   * One adapter rather than two because the domain enum describes what is being
   * measured and this one measures across both — splitting it would mean two
   * classes over the same scope resolution and the same connection, to satisfy a
   * taxonomy no consumer has asked about yet. If a consumer ever needs to select
   * one, that is the moment to split, and the descriptors already carry enough
   * to do it without moving a query.
   */
  readonly domain: IntelligenceDomain = 'conversation';

  readonly supportedGrains: readonly IntelligenceGrain[] = ['day', 'period'];

  /**
   * None.
   *
   * The tempting ones — win rate, cost per lead — are all either cross-cohort
   * (see `opportunities_won`'s limitation) or cross-domain, and cross-domain
   * ratios are exactly what this step does not compute.
   */
  readonly ratios: readonly IntelligenceRatioDescriptor[] = [];

  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
  ) {}

  async fetch(query: IntelligenceFactQuery): Promise<IntelligenceFactSet> {
    if (!this.supportedGrains.includes(query.grain)) {
      throw new Error(`Unsupported grain: ${query.grain}.`);
    }

    const { scope, window } = query;
    const timezone = query.dayBucketTimezone ?? null;

    const [conversations, inbound, created, won, qualified, historyStartsAt] =
      await Promise.all([
        this.countConversationsStarted(scope, window, query.grain, timezone),
        this.countInboundMessages(scope, window, query.grain, timezone),
        this.countOpportunitiesCreated(scope, window, query.grain, timezone),
        this.sumOpportunitiesWon(scope, window, query.grain, timezone),
        this.countFirstQualifications(scope, window, query.grain, timezone),
        this.qualificationHistoryStart(scope),
      ]);

    const qualificationCoverage: LeadFlowQualificationCoverage = {
      historyStartsAt,
      // No history at all also counts as "the window precedes it": every
      // qualification in the window is invisible, which is the same warning.
      windowPrecedesHistory:
        historyStartsAt === null || historyStartsAt.slice(0, 10) > window.since,
    };

    const currencies = new Set(
      won.filter((row) => row.currency).map((row) => row.currency as string),
    );

    /**
     * Whether `won_value` can be stated at all.
     *
     * Two currencies means no total — adding unlike units would produce a number
     * that looks like money and is not. *Zero* currencies is the opposite case
     * and must not be confused with it: nothing was won, so the value is a
     * definite `0`, not an unknown. Collapsing the two would report "we cannot
     * say" for the most ordinary result there is, and a consumer would render an
     * empty cell where the honest answer is zero.
     */
    const canTotal = currencies.size <= 1;

    return {
      domain: this.domain,
      subject: { type: 'workspace', id: scope.workspaceId },
      grain: query.grain,
      window: { since: window.since, until: window.until },
      // One currency or none. A scope holding deals in BRL and USD reports null
      // and every `won_value` fact null with it, rather than adding unlike units
      // into a number that looks like money and is not.
      currency: currencies.size === 1 ? [...currencies][0] : null,
      // Resolvable in principle from `business_mode`, and left null in this
      // step: a fact set spans many conversations and many opportunities, whose
      // modes differ, so a single label would have to pick one. It becomes a
      // dimension the day a caller needs to slice by it — which is what it is,
      // rather than a property of the set.
      businessMode: null,
      descriptors: this.descriptors(),
      facts: this.toFacts(
        query,
        { conversations, inbound, created, won, qualified },
        canTotal,
      ),
      provenance: {
        canonicalSource:
          'inbox_conversations, inbox_messages, inbox_conversation_events, ' +
          'crm_opportunities',
        // LeadFlow has no attribution model. Null is the honest answer, and
        // inventing one so the field is populated would make two fact sets look
        // comparable in a way they are not.
        attributionBasis: null,
        ingestionMode: 'live',
        /**
         * Where qualification history begins, carried as provenance.
         *
         * `notes` is `Record<string, string>`, so the two values are stringified
         * rather than nested. That constraint is the contract's, and it is met
         * here rather than widened: adding a LeadFlow-shaped field to
         * `IntelligenceFactSet` would put one domain's conditional metric into a
         * type every domain implements.
         */
        notes: {
          qualificationHistoryStartsAt: historyStartsAt ?? 'never',
          qualificationWindowPrecedesHistory: String(
            qualificationCoverage.windowPrecedesHistory,
          ),
        },
      },
      freshness: {
        // The query instant, because that is genuinely when these numbers were
        // true: the rows were written by this platform inside the transactions
        // that made them true, so there is no lag to report.
        asOf: new Date().toISOString(),
        // Never partial, and not as an optimistic default — there is no
        // ingestion window that could still be filling.
        isPartial: false,
        mode: 'canonical',
        coverage: {
          expectedDays: countWindowDays(window),
          // Every requested day, because a day with no rows is a day on which
          // nothing happened — not a day that was missed. This is exactly the
          // distinction the Social adapter cannot make, which is why
          // `basis` travels.
          coveredDays: countWindowDays(window),
          basis: 'canonical',
        },
      },
    };
  }

  private descriptors(): IntelligenceMetricDescriptor[] {
    return [
      ...LEADFLOW_CONVERSATION_METRICS,
      ...LEADFLOW_QUALIFICATION_METRICS,
      ...LEADFLOW_COMMERCIAL_METRICS,
    ];
  }

  private toFacts(
    query: IntelligenceFactQuery,
    counts: {
      conversations: CountRow[];
      inbound: CountRow[];
      created: CountRow[];
      won: WonRow[];
      qualified: CountRow[];
    },
    canTotal: boolean,
  ): IntelligenceFact[] {
    const buckets =
      query.grain === 'day' ? listWindowDays(query.window) : [null];

    const conversations = indexByDay(counts.conversations);
    const inbound = indexByDay(counts.inbound);
    const created = indexByDay(counts.created);
    const won = indexByDay(counts.won);
    const qualified = indexByDay(counts.qualified);

    const facts: IntelligenceFact[] = [];

    for (const day of buckets) {
      const key = day ?? PERIOD_BUCKET;
      const dimensions = day ? { date: day } : {};
      const wonRow = won.get(key);

      facts.push(
        {
          metricKey: 'conversations_started',
          value: readCount(conversations.get(key)),
          dimensions,
        },
        {
          metricKey: 'inbound_messages',
          value: readCount(inbound.get(key)),
          dimensions,
        },
        {
          // A genuine count of first qualifications observed in the bucket. It
          // is a floor when the window predates the evidence, which the fact
          // set's provenance states — the value itself stays a real count
          // rather than becoming null, because the qualifications it does see
          // did happen.
          metricKey: 'qualified_leads',
          value: readCount(qualified.get(key)),
          dimensions,
        },
        {
          metricKey: 'opportunities_created',
          value: readCount(created.get(key)),
          dimensions,
        },
        {
          metricKey: 'opportunities_won',
          value: readCount(wonRow),
          dimensions,
        },
        {
          metricKey: 'won_value',
          // Null only when the scope mixes currencies — the same rule the fact
          // set's `currency` follows, applied to the value it would otherwise
          // describe. A bucket with no won deals is `0`, not null: nothing was
          // won is a measurement, not a gap.
          value: canTotal ? (wonRow?.value ?? '0.00') : null,
          dimensions,
        },
      );
    }

    return facts;
  }

  /**
   * The same three conversation counts, split by the channel they arrived on.
   *
   * Added for the cross-domain destination breakdown: paid media resolves to a
   * *destination* (WhatsApp, Instagram Direct, Messenger) and the only honest
   * counterpart on this side is the Inbox channel of the same kind. Producing it
   * here, rather than in the projector, is the point — the client-binding
   * predicate is a JSONB condition that already has one definition in
   * `LEADFLOW_SCOPE_SQL`, and a cross-domain module writing its own channel query
   * would be the second place that decides which conversations belong to a
   * client. The two would eventually disagree, and the disagreement would surface
   * as one client's conversations counted under another's spend.
   *
   * Returned keyed by `inbox_channels.type` verbatim, not by a canonical name.
   * The mapping from a provider channel type onto the shared vocabulary lives in
   * `acquisition-channel.ts` and stays there: this adapter reports what the
   * column holds, and a channel type added after this was written comes back as
   * itself rather than being silently folded into a bucket.
   *
   * A conversation with no channel row contributes to the `null` key. That is
   * reachable in agency context — the scope predicate admits `channel_id IS
   * NULL` — and such a conversation has no channel to compare a destination
   * against, so it must not be folded into any named one.
   */
  async channelBreakdown(
    scope: IntelligenceScope,
    window: IntelligenceWindow,
    timezone: string | null,
  ): Promise<LeadFlowChannelBreakdown> {
    const [conversations, inbound, qualified] = await Promise.all([
      this.countConversationsByChannel(scope, window, timezone),
      this.countInboundMessagesByChannel(scope, window, timezone),
      this.countFirstQualificationsByChannel(scope, window, timezone),
    ]);

    const channels = new Map<string | null, LeadFlowChannelCounts>();

    const merge = (
      rows: ChannelCountRow[],
      field: keyof LeadFlowChannelCounts,
    ) => {
      for (const row of rows) {
        const existing = channels.get(row.channelType) ?? {
          conversationsReceived: '0',
          inboundMessages: '0',
          qualifiedLeads: '0',
        };

        channels.set(row.channelType, {
          ...existing,
          [field]: (BigInt(existing[field]) + BigInt(row.count)).toString(),
        });
      }
    };

    merge(conversations, 'conversationsReceived');
    merge(inbound, 'inboundMessages');
    merge(qualified, 'qualifiedLeads');

    return { channels };
  }

  /**
   * Conversations opened in the window, per channel type.
   *
   * The same predicate, window bounds and timezone handling as
   * `countConversationsStarted` — deliberately, so the per-channel counts sum to
   * the total rather than nearly to it. A reader who finds the breakdown
   * disagreeing with the total distrusts both.
   */
  private countConversationsByChannel(
    scope: IntelligenceScope,
    window: IntelligenceWindow,
    timezone: string | null,
  ): Promise<ChannelCountRow[]> {
    return this.dataSource.query<ChannelCountRow[]>(
      `
        /* leadflow-intelligence:conversations-by-channel */
        SELECT channel.type AS "channelType",
               COUNT(*)::text AS "count"
        FROM inbox_conversations conversation
        LEFT JOIN inbox_channels channel
          ON channel.id = conversation.channel_id
         AND channel.tenant_id = conversation.tenant_id
         AND channel.workspace_id = conversation.workspace_id
         AND channel.deleted_at IS NULL
        WHERE conversation.tenant_id = $1
          AND conversation.workspace_id = $2
          AND conversation.created_at >= ${WINDOW_START}
          AND conversation.created_at < ${WINDOW_END}
          AND ${LEADFLOW_SCOPE_SQL.CHANNEL}
        GROUP BY 1
      `,
      params(scope, window, timezone),
    );
  }

  private countInboundMessagesByChannel(
    scope: IntelligenceScope,
    window: IntelligenceWindow,
    timezone: string | null,
  ): Promise<ChannelCountRow[]> {
    return this.dataSource.query<ChannelCountRow[]>(
      `
        /* leadflow-intelligence:inbound-messages-by-channel */
        SELECT channel.type AS "channelType",
               COUNT(*)::text AS "count"
        FROM inbox_messages message
        INNER JOIN inbox_conversations conversation
          ON conversation.id = message.conversation_id
         AND conversation.tenant_id = message.tenant_id
         AND conversation.workspace_id = message.workspace_id
        LEFT JOIN inbox_channels channel
          ON channel.id = conversation.channel_id
         AND channel.tenant_id = conversation.tenant_id
         AND channel.workspace_id = conversation.workspace_id
         AND channel.deleted_at IS NULL
        WHERE message.tenant_id = $1
          AND message.workspace_id = $2
          AND message.direction = 'inbound'
          AND message.occurred_at >= ${WINDOW_START}
          AND message.occurred_at < ${WINDOW_END}
          AND ${LEADFLOW_SCOPE_SQL.CHANNEL}
        GROUP BY 1
      `,
      params(scope, window, timezone),
    );
  }

  /**
   * First qualifications in the window, per channel type.
   *
   * The inner query is `countFirstQualifications`' verbatim, including the part
   * that matters most: it finds each conversation's earliest qualification
   * across *all time* and only then keeps the ones inside the window. Filtering
   * by the window first would report a re-qualification in August as a new
   * qualification, and adding a channel dimension to the wrong shape would spread
   * that double count across the buckets rather than remove it.
   *
   * The channel is the conversation's, joined once in the inner query and carried
   * out — a conversation belongs to one channel, so grouping by it outside cannot
   * split a single qualification across two buckets.
   */
  private countFirstQualificationsByChannel(
    scope: IntelligenceScope,
    window: IntelligenceWindow,
    timezone: string | null,
  ): Promise<ChannelCountRow[]> {
    return this.dataSource.query<ChannelCountRow[]>(
      `
        /* leadflow-intelligence:first-qualifications-by-channel */
        SELECT first_qualification.channel_type AS "channelType",
               COUNT(*)::text AS "count"
        FROM (
          SELECT DISTINCT ON (event.conversation_id)
                 event.conversation_id,
                 channel.type AS channel_type,
                 (event.payload->>'occurredAt')::timestamptz AS occurred_at
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
            AND event.event_type = '${QUALIFICATION_EVENT}'
            AND event.payload->>'newStatus' = 'qualified'
            AND event.payload->>'occurredAt' IS NOT NULL
            AND ${LEADFLOW_SCOPE_SQL.CHANNEL}
          ORDER BY event.conversation_id,
                   (event.payload->>'occurredAt')::timestamptz ASC,
                   event.created_at ASC
        ) first_qualification
        WHERE first_qualification.occurred_at >= ${WINDOW_START}
          AND first_qualification.occurred_at < ${WINDOW_END}
        GROUP BY 1
      `,
      params(scope, window, timezone),
    );
  }

  /**
   * Conversations opened in the window.
   *
   * The client predicate is the operational service's, verbatim in meaning: in
   * client context the conversation's channel must carry that `clientId`; in
   * agency context a conversation counts when it has no channel, or its channel
   * has no client, or its channel is explicitly agency-operated.
   */
  private countConversationsStarted(
    scope: IntelligenceScope,
    window: IntelligenceWindow,
    grain: IntelligenceGrain,
    timezone: string | null,
  ): Promise<CountRow[]> {
    return this.dataSource.query<CountRow[]>(
      `
        /* leadflow-intelligence:conversations-started */
        SELECT ${bucket(grain, 'conversation.created_at')} AS "day",
               COUNT(*)::text AS "count"
        FROM inbox_conversations conversation
        LEFT JOIN inbox_channels channel
          ON channel.id = conversation.channel_id
         AND channel.tenant_id = conversation.tenant_id
         AND channel.workspace_id = conversation.workspace_id
         AND channel.deleted_at IS NULL
        WHERE conversation.tenant_id = $1
          AND conversation.workspace_id = $2
          AND conversation.created_at >= ${WINDOW_START}
          AND conversation.created_at < ${WINDOW_END}
          AND ${LEADFLOW_SCOPE_SQL.CHANNEL}
        GROUP BY 1
      `,
      params(scope, window, timezone),
    );
  }

  private countInboundMessages(
    scope: IntelligenceScope,
    window: IntelligenceWindow,
    grain: IntelligenceGrain,
    timezone: string | null,
  ): Promise<CountRow[]> {
    return this.dataSource.query<CountRow[]>(
      `
        /* leadflow-intelligence:inbound-messages */
        SELECT ${bucket(grain, 'message.occurred_at')} AS "day",
               COUNT(*)::text AS "count"
        FROM inbox_messages message
        INNER JOIN inbox_conversations conversation
          ON conversation.id = message.conversation_id
         AND conversation.tenant_id = message.tenant_id
         AND conversation.workspace_id = message.workspace_id
        LEFT JOIN inbox_channels channel
          ON channel.id = conversation.channel_id
         AND channel.tenant_id = conversation.tenant_id
         AND channel.workspace_id = conversation.workspace_id
         AND channel.deleted_at IS NULL
        WHERE message.tenant_id = $1
          AND message.workspace_id = $2
          AND message.direction = 'inbound'
          AND message.occurred_at >= ${WINDOW_START}
          AND message.occurred_at < ${WINDOW_END}
          AND ${LEADFLOW_SCOPE_SQL.CHANNEL}
        GROUP BY 1
      `,
      params(scope, window, timezone),
    );
  }

  /**
   * Conversations whose **first** observed qualification lands in the window.
   *
   * The shape matters more than the SQL. The inner query finds, per
   * conversation, the earliest transition into `qualified` across *all time* —
   * not within the window — and only then does the outer query keep the ones
   * that fall inside it. Filtering by the window first would find the earliest
   * qualification *in the window*, which for a conversation qualified in June,
   * disqualified in July and re-qualified in August would report a new
   * qualification in August. That is the double count the brief forbids, and it
   * is invisible in any test whose fixtures do not span the window boundary.
   *
   * `occurredAt` from the payload, not `created_at`: the recorder takes a
   * caller-supplied instant so a provider timestamp can be honoured, and the row
   * insert time is merely when Lyra got around to writing it.
   *
   * The status is read from the payload rather than joined against the
   * conversation's current column — that column is exactly the current-state
   * fallback this step exists to stop using.
   */
  private countFirstQualifications(
    scope: IntelligenceScope,
    window: IntelligenceWindow,
    grain: IntelligenceGrain,
    timezone: string | null,
  ): Promise<CountRow[]> {
    return this.dataSource.query<CountRow[]>(
      `
        /* leadflow-intelligence:first-qualifications */
        SELECT ${bucket(grain, 'first_qualification.occurred_at')} AS "day",
               COUNT(*)::text AS "count"
        FROM (
          SELECT DISTINCT ON (event.conversation_id)
                 event.conversation_id,
                 (event.payload->>'occurredAt')::timestamptz AS occurred_at
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
            AND event.event_type = '${QUALIFICATION_EVENT}'
            AND event.payload->>'newStatus' = 'qualified'
            AND event.payload->>'occurredAt' IS NOT NULL
            AND ${LEADFLOW_SCOPE_SQL.CHANNEL}
          ORDER BY event.conversation_id,
                   (event.payload->>'occurredAt')::timestamptz ASC,
                   event.created_at ASC
        ) first_qualification
        WHERE first_qualification.occurred_at >= ${WINDOW_START}
          AND first_qualification.occurred_at < ${WINDOW_END}
        GROUP BY 1
      `,
      params(scope, window, timezone),
    );
  }

  /**
   * The earliest qualification transition this scope has on record.
   *
   * Answers "where does history begin" from the evidence itself rather than
   * from a deploy date constant, so it stays correct across environments that
   * deployed on different days and across a database restored from a backup
   * that predates the feature.
   *
   * Unscoped by window on purpose — that is the question.
   */
  private async qualificationHistoryStart(
    scope: IntelligenceScope,
  ): Promise<string | null> {
    const rows = await this.dataSource.query<Array<{ startsAt: Date | null }>>(
      `
        /* leadflow-intelligence:qualification-history-start */
        SELECT MIN((event.payload->>'occurredAt')::timestamptz) AS "startsAt"
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
          AND event.event_type = '${QUALIFICATION_EVENT}'
          AND event.payload->>'occurredAt' IS NOT NULL
          AND ${LEADFLOW_SCOPE_SQL.CHANNEL}
      `,
      leadFlowScopeParameters({
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        contextType: scope.agencyClientId ? 'client' : 'agency',
        clientId: scope.agencyClientId,
      }),
    );

    const startsAt = rows[0]?.startsAt ?? null;

    return startsAt ? new Date(startsAt).toISOString() : null;
  }

  private countOpportunitiesCreated(
    scope: IntelligenceScope,
    window: IntelligenceWindow,
    grain: IntelligenceGrain,
    timezone: string | null,
  ): Promise<CountRow[]> {
    return this.dataSource.query<CountRow[]>(
      `
        /* leadflow-intelligence:opportunities-created */
        SELECT ${bucket(grain, 'opportunity.created_at')} AS "day",
               COUNT(*)::text AS "count"
        FROM crm_opportunities opportunity
        WHERE opportunity.tenant_id = $1
          AND opportunity.workspace_id = $2
          AND opportunity.created_at >= ${WINDOW_START}
          AND opportunity.created_at < ${WINDOW_END}
          AND ${LEADFLOW_SCOPE_SQL.OPPORTUNITY}
        GROUP BY 1
      `,
      params(scope, window, timezone),
    );
  }

  /**
   * Deals closed won in the window, and their value.
   *
   * Cohorted on `won_at`, not `created_at` — this counts what closed, not what
   * was opened. The two are different cohorts and the descriptor says so, which
   * is what stops a consumer dividing one by the other and calling it a win
   * rate.
   *
   * Grouped by currency as well as day so the caller can tell a single-currency
   * scope from a mixed one; the adapter refuses to total a mixed one.
   */
  private sumOpportunitiesWon(
    scope: IntelligenceScope,
    window: IntelligenceWindow,
    grain: IntelligenceGrain,
    timezone: string | null,
  ): Promise<WonRow[]> {
    return this.dataSource.query<WonRow[]>(
      `
        /* leadflow-intelligence:opportunities-won */
        SELECT ${bucket(grain, 'opportunity.won_at')} AS "day",
               opportunity.currency AS "currency",
               COUNT(*)::text AS "count",
               COALESCE(SUM(opportunity.value_amount), 0)::text AS "value"
        FROM crm_opportunities opportunity
        WHERE opportunity.tenant_id = $1
          AND opportunity.workspace_id = $2
          AND opportunity.status = 'won'
          AND opportunity.won_at IS NOT NULL
          AND opportunity.won_at >= ${WINDOW_START}
          AND opportunity.won_at < ${WINDOW_END}
          AND ${LEADFLOW_SCOPE_SQL.OPPORTUNITY}
        GROUP BY 1, 2
      `,
      params(scope, window, timezone),
    );
  }
}

/** Key for the single bucket of a `period`-grain result. */
const PERIOD_BUCKET = '__period__';

type CountRow = { day: string | null; count: string };
/** One channel's count. `channelType` is null for a conversation with none. */
type ChannelCountRow = { channelType: string | null; count: string };
type WonRow = CountRow & { currency: string | null; value: string | null };

/**
 * The GROUP BY expression for the requested grain.
 *
 * Never interpolates anything a caller supplied: `grain` is a two-member union
 * and the column name is a literal in this file. At `period` grain it groups on
 * a constant, which collapses to one row without a second query shape.
 *
 * The cast to `date` is what makes a day here mean the same thing as a day in
 * the window — both are calendar days in the database's zone, and the window's
 * bounds were widened to instants by the same `::date` cast in the WHERE clause.
 *
 * When the caller named a timezone (`$7`), the instant is converted into that
 * zone *before* the cast, so a day means the same calendar day the ad account
 * reports in. The zone is a **bound parameter**, never interpolated: it is the
 * one value in this file that originates outside it, and `AT TIME ZONE` takes a
 * string operand precisely so it does not have to be spliced into SQL. An
 * invalid zone raises a Postgres error rather than silently falling back — a
 * silent fallback would produce numbers that are quietly cut on the wrong day.
 */
function bucket(grain: IntelligenceGrain, column: string): string {
  if (grain !== 'day') return `'${PERIOD_BUCKET}'`;

  return `to_char(
    (CASE WHEN $7::text IS NULL THEN ${column}
          ELSE ${column} AT TIME ZONE $7::text END)::date,
    'YYYY-MM-DD'
  )`;
}

/**
 * The seven positional parameters every query here binds.
 *
 * `$1`–`$4` come from `leadFlowScopeParameters`, which is the contract
 * `LEADFLOW_SCOPE_SQL` reads — so the window bounds start at `$5` rather than
 * `$4`. Getting that order from the shared helper instead of assembling it here
 * is the point: the predicates and their parameters cannot drift apart.
 *
 * `$7` is the day-bucket timezone, or null. It is bound on every query whether
 * or not the grain uses it, so the parameter list has one shape — a list whose
 * length depended on the grain is how `$7` eventually becomes `$6` in one query
 * and shifts the window bounds under the others.
 */
function params(
  scope: IntelligenceScope,
  window: IntelligenceWindow,
  timezone: string | null,
) {
  return [
    ...leadFlowScopeParameters({
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      contextType: scope.agencyClientId ? 'client' : 'agency',
      clientId: scope.agencyClientId,
    }),
    window.since,
    window.until,
    timezone,
  ];
}

/**
 * The window's lower bound as an instant, in the caller's day-bucket zone.
 *
 * `$5::date` alone means midnight in the *database's* zone. If days are being
 * cut in São Paulo, the window has to start at São Paulo's midnight too —
 * otherwise the first three hours of the first day are excluded from the range
 * while the bucket expression happily assigns them to it, and the earliest day
 * silently under-reports.
 *
 * `AT TIME ZONE` on a bare `timestamp` reads it *as* that zone and returns an
 * instant, which is the direction needed here.
 */
const WINDOW_START = `(CASE WHEN $7::text IS NULL THEN $5::timestamptz
       ELSE $5::timestamp AT TIME ZONE $7::text END)`;

/** The exclusive upper bound: the same rule, one day past `until`. */
const WINDOW_END = `(CASE WHEN $7::text IS NULL THEN ($6::date + INTERVAL '1 day')::timestamptz
       ELSE ($6::date + INTERVAL '1 day')::timestamp AT TIME ZONE $7::text END)`;

function indexByDay<T extends CountRow>(rows: T[]): Map<string, T> {
  const indexed = new Map<string, T>();

  for (const row of rows) {
    const key = row.day ?? PERIOD_BUCKET;
    const existing = indexed.get(key);

    if (!existing) {
      indexed.set(key, row);
      continue;
    }

    // Only `sumOpportunitiesWon` can return several rows per bucket — one per
    // currency — and reaching this branch means the scope holds more than one.
    // The count folds, because a won deal is a won deal in any currency. The
    // value is set to `null` rather than added: the caller's single-currency
    // check will suppress it anyway, and leaving a partial sum here would make
    // the wrong value available to anything that skipped the check.
    indexed.set(key, {
      ...existing,
      count: (BigInt(existing.count) + BigInt(row.count)).toString(),
      ...('value' in existing ? { value: null } : {}),
    } as T);
  }

  return indexed;
}

/** A count as text, with an absent bucket meaning a genuine zero. */
function readCount(row: CountRow | undefined): string {
  return row?.count ?? '0';
}
