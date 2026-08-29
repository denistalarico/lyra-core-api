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
} from './leadflow-metrics';

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

    const [conversations, inbound, created, won] = await Promise.all([
      this.countConversationsStarted(scope, window, query.grain, timezone),
      this.countInboundMessages(scope, window, query.grain, timezone),
      this.countOpportunitiesCreated(scope, window, query.grain, timezone),
      this.sumOpportunitiesWon(scope, window, query.grain, timezone),
    ]);

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
        { conversations, inbound, created, won },
        canTotal,
      ),
      provenance: {
        canonicalSource:
          'inbox_conversations, inbox_messages, crm_opportunities',
        // LeadFlow has no attribution model. Null is the honest answer, and
        // inventing one so the field is populated would make two fact sets look
        // comparable in a way they are not.
        attributionBasis: null,
        ingestionMode: 'live',
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
    return [...LEADFLOW_CONVERSATION_METRICS, ...LEADFLOW_COMMERCIAL_METRICS];
  }

  private toFacts(
    query: IntelligenceFactQuery,
    counts: {
      conversations: CountRow[];
      inbound: CountRow[];
      created: CountRow[];
      won: WonRow[];
    },
    canTotal: boolean,
  ): IntelligenceFact[] {
    const buckets =
      query.grain === 'day' ? listWindowDays(query.window) : [null];

    const conversations = indexByDay(counts.conversations);
    const inbound = indexByDay(counts.inbound);
    const created = indexByDay(counts.created);
    const won = indexByDay(counts.won);

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
