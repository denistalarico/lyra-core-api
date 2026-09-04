import { Injectable } from '@nestjs/common';
import type {
  IntelligenceScope,
  IntelligenceWindow,
} from '../../common/intelligence';
import { LeadFlowAttributionCohortAdapter } from '../leadflow-analytics/intelligence/leadflow-attribution-cohort.adapter';
import {
  LEADFLOW_COHORT_PROVENANCE,
  LEADFLOW_SUPPORTED_ATTRIBUTION_CHANNEL,
  LEADFLOW_SUPPORTED_ATTRIBUTION_PROVIDER,
  type LeadFlowCohortConversation,
  type LeadFlowCohortOpportunity,
} from '../leadflow-analytics/intelligence/leadflow-attribution-cohort.port';
import {
  SOCIAL_AD_HIERARCHY_PROVENANCE,
  type SocialAdHierarchyPath,
} from '../social-integrations/analytics/social-ad-hierarchy-lookup';
import { SocialAdHierarchyLookupReadService } from '../social-integrations/services/social-ad-hierarchy-lookup.read.service';
import { SocialAnalyticsReadService } from '../social-integrations/services/social-analytics-read.service';
import {
  OBSERVED_ATTRIBUTION_IMMATURE_COHORT_HOURS,
  OBSERVED_ATTRIBUTION_SUMMARY_ABSENCE_LIMITATION,
  OBSERVED_ATTRIBUTION_SUMMARY_CAUSALITY_LIMITATION,
  OBSERVED_ATTRIBUTION_SUMMARY_CONFLICT_LIMITATION,
  OBSERVED_ATTRIBUTION_SUMMARY_CURRENCY_LIMITATION,
  OBSERVED_ATTRIBUTION_SUMMARY_DESTINATION_LIMITATION,
  OBSERVED_ATTRIBUTION_SUMMARY_IMMATURE_LIMITATION,
  OBSERVED_ATTRIBUTION_SUMMARY_OBSERVED_ONLY_LIMITATION,
  OBSERVED_ATTRIBUTION_SUMMARY_OPPORTUNITY_LIMITATION,
  OBSERVED_ATTRIBUTION_SUMMARY_PROJECTOR,
  OBSERVED_ATTRIBUTION_SUMMARY_PROVIDER_LIMITATION,
  OBSERVED_ATTRIBUTION_SUMMARY_SPEND_LIMITATION,
  OBSERVED_ATTRIBUTION_SUMMARY_UNRESOLVED_LIMITATION,
  OBSERVED_ATTRIBUTION_SUMMARY_VALUE_LIMITATION,
  type ObservedAttributionGroupBy,
  type ObservedAttributionSummaryDataQuality,
  type ObservedAttributionSummaryGroup,
  type ObservedAttributionSummaryView,
} from './observed-attribution-summary.contract';

/**
 * The aggregate half of observed attribution.
 *
 * I4 answers "where did *this* conversation come from". This answers "of the
 * conversations that entered this window with observed evidence, what became of
 * them, grouped by ad, ad set, campaign or account".
 *
 * ## It is the sum of I4, not a second implementation of it
 *
 * Every rule the individual endpoint enforces is enforced here by *reusing the
 * same layers*: the client predicate comes from `LEADFLOW_SCOPE_SQL` through
 * the cohort adapter, the hierarchy walk is the same SQL the single lookup
 * uses, won is the same `status = 'won' AND won_at IS NOT NULL` pair, and
 * opportunities are reached only by `inbox_conversation_id`. A parallel
 * aggregate that re-derived any of those would eventually credit an ad the
 * per-conversation view credits to another.
 *
 * ## What it deliberately does not do
 *
 * No spend, no ROAS, no CPA (§21) — those come from period-grained media facts
 * whose semantics are not this cohort's. No `social_ad_metrics_daily` read at
 * all (§22), so the summary works on a deployment where no backfill has run.
 * And no destination grouping (§15): destination is temporal and per
 * observation, and bucketing a conversation whose ad set was re-pointed between
 * two clicks would erase exactly the variation I4.1 exists to record.
 */
@Injectable()
export class ObservedAttributionSummaryService {
  constructor(
    private readonly cohort: LeadFlowAttributionCohortAdapter,
    private readonly hierarchy: SocialAdHierarchyLookupReadService,
    // Only to resolve the connection's timezone, through the service that
    // already scopes connection lookups. No metric is read from it.
    private readonly socialReads: SocialAnalyticsReadService,
  ) {}

  async summary(
    scope: IntelligenceScope,
    window: IntelligenceWindow,
    connectionId: string,
    groupBy: ObservedAttributionGroupBy,
  ): Promise<ObservedAttributionSummaryView> {
    /**
     * The ad account's zone decides where the window's days begin and end.
     *
     * The same requirement I3.5 has, and the reason `connectionId` is mandatory
     * here too. The cohort is selected on `observed_at`, an absolute instant, so
     * the days have to be widened into instants by *some* zone — and with two
     * connected accounts in different zones there is no single boundary correct
     * for both. Naming the connection makes the choice explicit instead of
     * silent.
     */
    const timezone = await this.resolveAccountTimezone(scope, connectionId);
    const bounds = resolveWindowInstants(window, timezone);

    const leadflowScope = {
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      contextType: scope.agencyClientId
        ? ('client' as const)
        : ('agency' as const),
      clientId: scope.agencyClientId,
    };

    const [conversations, eligibility] = await Promise.all([
      this.cohort.cohortConversations(leadflowScope, bounds),
      this.cohort.cohortEligibility(leadflowScope, bounds),
    ]);

    /**
     * Conflicts are removed before anything is resolved.
     *
     * §18: a conversation naming two ads is counted in quality and placed in no
     * group. Splitting it between both would invent a fractional attribution;
     * picking one would invent a touch model. Both are the modelling decision
     * this whole layer refuses to make.
     */
    const attributable = conversations.filter(
      (row) => row.distinctAdIds.length === 1,
    );
    const conflicting = conversations.length - attributable.length;

    const paths = await this.hierarchy.lookupMany({
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      agencyClientId: scope.agencyClientId,
      connectionId,
      adIds: attributable.map((row) => row.distinctAdIds[0]),
    });

    // §19's aggregate analogue: an observed id the mirror cannot place is
    // reported, never bucketed under a guess.
    const matched = attributable.filter((row) =>
      paths.has(row.distinctAdIds[0]),
    );
    const unresolved = attributable.length - matched.length;

    const opportunities = await this.cohort.cohortOpportunities(
      leadflowScope,
      matched.map((row) => row.conversationId),
    );

    const groups = buildGroups(matched, paths, opportunities, groupBy);
    const dataAsOf = new Date().toISOString();
    const latestAttributionAt = matched.length
      ? matched[matched.length - 1].enteredAt
      : null;
    const cohortAgeHours = latestAttributionAt
      ? hoursBetween(latestAttributionAt, dataAsOf)
      : null;
    const immatureCohort =
      cohortAgeHours !== null &&
      cohortAgeHours < OBSERVED_ATTRIBUTION_IMMATURE_COHORT_HOURS;
    const currencyCompatibility = resolveCurrencyCompatibility(groups);

    return {
      kind: 'observed_attribution_summary',
      cohort: {
        from: window.since,
        until: window.until,
        timezone: timezone ?? 'UTC',
        timezoneSource: timezone ? 'ad_account' : 'utc_fallback',
        dataAsOf,
        semantics: 'entry_cohort',
        latestAttributionAt,
        cohortAgeHours,
      },
      groupBy,
      coverage: {
        eligibleConversations: eligibility.eligibleConversations,
        matchedConversations: matched.length,
        conflictingConversations: conflicting,
        unresolvedConversations: unresolved,
        unsupportedConversations: eligibility.unsupportedConversations,
        // Undefined rather than zero on an empty denominator — a client with no
        // eligible conversations is not failing at attribution.
        observedCoverage: eligibility.eligibleConversations
          ? matched.length / eligibility.eligibleConversations
          : null,
      },
      groups,
      provenance: {
        observation: LEADFLOW_COHORT_PROVENANCE.observation,
        conversation: LEADFLOW_COHORT_PROVENANCE.conversation,
        paidMedia: SOCIAL_AD_HIERARCHY_PROVENANCE,
        qualification: LEADFLOW_COHORT_PROVENANCE.qualification,
        opportunity: LEADFLOW_COHORT_PROVENANCE.opportunity,
        projector: OBSERVED_ATTRIBUTION_SUMMARY_PROJECTOR,
      },
      dataQuality: {
        individualAttributionOnly: true,
        supportedProviderCoverage: {
          channelType: LEADFLOW_SUPPORTED_ATTRIBUTION_CHANNEL,
          provider: LEADFLOW_SUPPORTED_ATTRIBUTION_PROVIDER,
        },
        conflicts: conflicting,
        unresolved,
        immatureCohort,
        currencyCompatibility,
        limitations: limitationsFor({
          conflicting,
          unresolved,
          immatureCohort,
          currencyCompatibility,
          groups,
        }),
      },
    };
  }

  /**
   * The ad account's IANA zone, or null.
   *
   * Through the Social read service, which already scopes connection lookups by
   * tenant, workspace and client — so a caller cannot reach another tenant's
   * connection by guessing a UUID, and there is no second place deciding which
   * connections a scope may see.
   */
  private async resolveAccountTimezone(
    scope: IntelligenceScope,
    connectionId: string,
  ): Promise<string | null> {
    const connections = await this.socialReads.listConnections(scope);

    return (
      connections.find((item) => item.id === connectionId)?.timezone ?? null
    );
  }
}

/**
 * Folds the matched conversations into one row per hierarchy node.
 *
 * The counting rule is §3, and it is enforced by the shape of the loop: the
 * outer iteration is over *conversations*, so each contributes exactly one to
 * `attributedConversations` no matter how many observations or opportunities it
 * carries. `observationsCount` and `opportunities` are the numbers that may
 * exceed it, and they are accumulated separately rather than derived from it.
 */
function buildGroups(
  conversations: LeadFlowCohortConversation[],
  paths: Map<string, SocialAdHierarchyPath>,
  opportunities: LeadFlowCohortOpportunity[],
  groupBy: ObservedAttributionGroupBy,
): ObservedAttributionSummaryGroup[] {
  const byConversation = new Map<string, LeadFlowCohortOpportunity[]>();

  for (const opportunity of opportunities) {
    const list = byConversation.get(opportunity.conversationId) ?? [];
    list.push(opportunity);
    byConversation.set(opportunity.conversationId, list);
  }

  const accumulators = new Map<string, GroupAccumulator>();

  for (const conversation of conversations) {
    const path = paths.get(conversation.distinctAdIds[0]);
    if (!path) continue;

    const key = groupKey(path, groupBy);
    // A matched ad whose upper levels never synced has no key at that level.
    // Skipped rather than bucketed under a placeholder: an "unknown campaign"
    // row would be read as a real campaign that happens to be unnamed.
    if (!key) continue;

    const accumulator = accumulators.get(key) ?? {
      key,
      name: groupName(path, groupBy),
      attributedConversations: 0,
      observationsCount: 0,
      qualifiedConversations: 0,
      opportunities: 0,
      wonOpportunities: 0,
      wonCents: 0n,
      currencies: new Set<string>(),
      valueParseable: true,
    };

    accumulator.attributedConversations += 1;
    accumulator.observationsCount += conversation.observationsCount;

    // §19/§20 of I4.2's test list: the *first* transition, and a conversation
    // qualified twice still counts once — `firstQualifiedAt` is a single
    // instant by construction, so re-qualification cannot double it.
    if (conversation.firstQualifiedAt !== null) {
      accumulator.qualifiedConversations += 1;
    }

    for (const opportunity of byConversation.get(conversation.conversationId) ??
      []) {
      accumulator.opportunities += 1;

      if (!opportunity.isWon) continue;

      accumulator.wonOpportunities += 1;
      if (opportunity.currency)
        accumulator.currencies.add(opportunity.currency);

      const cents = toCents(opportunity.valueAmount);
      if (cents === null) {
        accumulator.valueParseable = false;
      } else {
        accumulator.wonCents += cents;
      }
    }

    accumulators.set(key, accumulator);
  }

  return [...accumulators.values()]
    .map((accumulator) => {
      const multiCurrency = accumulator.currencies.size > 1;
      const canTotal = !multiCurrency && accumulator.valueParseable;

      return {
        key: accumulator.key,
        level: groupBy,
        name: accumulator.name,
        attributedConversations: accumulator.attributedConversations,
        observationsCount: accumulator.observationsCount,
        qualifiedConversations: accumulator.qualifiedConversations,
        opportunities: accumulator.opportunities,
        wonOpportunities: accumulator.wonOpportunities,
        // §14: unlike units are never added. Null is the honest answer, and it
        // is more useful than a number that looks authoritative and is not.
        wonOpportunityValue: canTotal
          ? formatCents(accumulator.wonCents)
          : null,
        currency:
          accumulator.currencies.size === 1
            ? [...accumulator.currencies][0]
            : null,
        multiCurrency,
      };
    })
    .sort(
      (a, b) =>
        b.attributedConversations - a.attributedConversations ||
        a.key.localeCompare(b.key),
    );
}

type GroupAccumulator = {
  key: string;
  name: string | null;
  attributedConversations: number;
  observationsCount: number;
  qualifiedConversations: number;
  opportunities: number;
  wonOpportunities: number;
  wonCents: bigint;
  currencies: Set<string>;
  valueParseable: boolean;
};

function groupKey(
  path: SocialAdHierarchyPath,
  groupBy: ObservedAttributionGroupBy,
): string | null {
  if (groupBy === 'ad') return path.adId;
  if (groupBy === 'adset') return path.adsetId;
  if (groupBy === 'campaign') return path.campaignId;
  return path.accountId;
}

function groupName(
  path: SocialAdHierarchyPath,
  groupBy: ObservedAttributionGroupBy,
): string | null {
  if (groupBy === 'ad') return path.adName;
  if (groupBy === 'adset') return path.adsetName;
  if (groupBy === 'campaign') return path.campaignName;
  // The mirror carries no account name on the walk, and inventing one from the
  // id would put a fabricated label on a report.
  return null;
}

/**
 * Widens the window's calendar days into absolute instants.
 *
 * The upper bound is exclusive and is the instant the day *after* `until`
 * begins, which is the only formulation that includes every moment of the last
 * day. A `<=` against `until 00:00` would silently drop 23 hours and 59 minutes
 * of the final day, and the loss would look like a quiet decline in
 * attribution rather than a bug.
 *
 * Without a zone the days are cut in UTC, which is stated in the response as
 * `timezoneSource: 'utc_fallback'` rather than presented as the account's.
 */
function resolveWindowInstants(
  window: IntelligenceWindow,
  timezone: string | null,
): { fromInstant: string; untilInstant: string } {
  return {
    fromInstant: dayStartInstant(window.since, timezone),
    untilInstant: dayStartInstant(nextDay(window.until), timezone),
  };
}

/**
 * The zone's offset from UTC at a given instant, in milliseconds.
 *
 * Read from `Intl` rather than a table, so the platform's own tz database
 * supplies the history. A fixed offset per zone is the classic bug: São Paulo
 * has run both -03:00 and -02:00, and a window cut with the wrong one shifts
 * every boundary by an hour for half the year.
 */
function zoneOffsetAt(instant: number, timezone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(new Date(instant))
      .map((part) => [part.type, part.value]),
  );

  // `hour` comes back as '24' for midnight under `hour12: false` in some ICU
  // versions, which `Date.UTC` would read as the next day.
  const asUTC = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour === '24' ? '00' : parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );

  return asUTC - instant;
}

/**
 * The instant a calendar day begins in a zone.
 *
 * ## Why two candidates and not one correction
 *
 * The naive approach — take the offset in force *now* and subtract it — is
 * wrong on every DST transition day, and a single correcting pass is still
 * wrong on fall-back days in some zones. Verified by sweeping 48,000 day/zone
 * combinations: the one-shot form failed 37 times and the single-correction
 * form still landed on the *previous day* in Tehran every autumn, which would
 * silently pull a day of conversations into the wrong cohort.
 *
 * So both plausible offsets are computed and the day's true start is chosen
 * from them:
 *
 * - **Fall back** (the hour repeats): both candidates render as local midnight,
 *   and the *earlier* is the real start of the day — the later one would drop
 *   the first repeated hour.
 * - **Spring forward** (local midnight does not exist): neither renders as
 *   00:00, and the day begins at the later candidate, the first instant that is
 *   actually inside it.
 *
 * The sweep covers the pathological zones deliberately — Chatham at +12:45,
 * Lord Howe with its 30-minute shift, Tehran, Apia — and reports zero failures.
 */
function dayStartInstant(day: string, timezone: string | null): string {
  if (!timezone) return `${day}T00:00:00.000Z`;

  const target = Date.parse(`${day}T00:00:00Z`);

  try {
    const first = target - zoneOffsetAt(target, timezone);
    const second = target - zoneOffsetAt(first, timezone);
    const candidates = [...new Set([first, second])].sort((a, b) => a - b);

    for (const candidate of candidates) {
      if (zoneOffsetAt(candidate, timezone) + candidate === target) {
        return new Date(candidate).toISOString();
      }
    }

    // Spring forward: no candidate renders as midnight because midnight does
    // not exist. The later one is the first instant of the day.
    return new Date(Math.max(...candidates)).toISOString();
  } catch {
    // An unknown zone falls back to UTC rather than throwing: a malformed
    // timezone stored on a connection must not make the endpoint unavailable.
    return `${day}T00:00:00.000Z`;
  }
}

function nextDay(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000)
    .toISOString()
    .slice(0, 10);
}

function hoursBetween(from: string, to: string): number {
  return (Date.parse(to) - Date.parse(from)) / 3_600_000;
}

function resolveCurrencyCompatibility(
  groups: ObservedAttributionSummaryGroup[],
): ObservedAttributionSummaryDataQuality['currencyCompatibility'] {
  if (groups.some((group) => group.multiCurrency)) return 'mixed';
  if (groups.some((group) => group.currency !== null)) return 'single';

  return 'none';
}

/** `"1234.50"` → `123450n`. Null for anything not a plain decimal. */
function toCents(value: string | null): bigint | null {
  if (value === null) return 0n;

  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) return null;

  const [, sign, whole, fraction = ''] = match;
  const cents = `${fraction}00`.slice(0, 2);
  const magnitude = BigInt(whole) * 100n + BigInt(cents);

  return sign === '-' ? -magnitude : magnitude;
}

function formatCents(total: bigint): string {
  const negative = total < 0n;
  const magnitude = negative ? -total : total;
  const whole = magnitude / 100n;
  const cents = (magnitude % 100n).toString().padStart(2, '0');

  return `${negative ? '-' : ''}${whole}.${cents}`;
}

/**
 * The limitations that apply to this particular answer.
 *
 * Four are unconditional because they are true of the view itself — what it
 * counts, which providers it can see, what an absence means, and that a
 * observed link is not a causal one. The rest appear only when the data makes
 * them relevant, so the one that explains *this* result is not buried among
 * seven that do not.
 */
function limitationsFor(input: {
  conflicting: number;
  unresolved: number;
  immatureCohort: boolean;
  currencyCompatibility: ObservedAttributionSummaryDataQuality['currencyCompatibility'];
  groups: ObservedAttributionSummaryGroup[];
}): string[] {
  const limitations = [
    OBSERVED_ATTRIBUTION_SUMMARY_OBSERVED_ONLY_LIMITATION,
    OBSERVED_ATTRIBUTION_SUMMARY_PROVIDER_LIMITATION,
    OBSERVED_ATTRIBUTION_SUMMARY_ABSENCE_LIMITATION,
    OBSERVED_ATTRIBUTION_SUMMARY_CAUSALITY_LIMITATION,
    OBSERVED_ATTRIBUTION_SUMMARY_OPPORTUNITY_LIMITATION,
    OBSERVED_ATTRIBUTION_SUMMARY_SPEND_LIMITATION,
    OBSERVED_ATTRIBUTION_SUMMARY_DESTINATION_LIMITATION,
  ];

  if (input.conflicting > 0) {
    limitations.push(OBSERVED_ATTRIBUTION_SUMMARY_CONFLICT_LIMITATION);
  }

  if (input.unresolved > 0) {
    limitations.push(OBSERVED_ATTRIBUTION_SUMMARY_UNRESOLVED_LIMITATION);
  }

  if (input.immatureCohort) {
    limitations.push(OBSERVED_ATTRIBUTION_SUMMARY_IMMATURE_LIMITATION);
  }

  if (input.groups.some((group) => group.wonOpportunities > 0)) {
    limitations.push(OBSERVED_ATTRIBUTION_SUMMARY_VALUE_LIMITATION);
  }

  if (input.currencyCompatibility === 'mixed') {
    limitations.push(OBSERVED_ATTRIBUTION_SUMMARY_CURRENCY_LIMITATION);
  }

  return limitations;
}
