import { Injectable } from '@nestjs/common';
import {
  BUSINESS_MODE_CURRENT_ONLY_LIMITATION,
  BUSINESS_MODE_UNKNOWN_KEY_LIMITATION,
  businessModeQuality,
  type BusinessModeDimension,
  type IntelligenceScope,
  type IntelligenceWindow,
} from '../../common/intelligence';
import { BusinessModeDimensionAdapter } from '../leadflow-analytics/intelligence/business-mode-dimension.adapter';
import { LeadFlowAttributionCohortAdapter } from '../leadflow-analytics/intelligence/leadflow-attribution-cohort.adapter';
import {
  LEADFLOW_COHORT_PROVENANCE,
  LEADFLOW_SUPPORTED_ATTRIBUTION_CHANNEL,
  LEADFLOW_SUPPORTED_ATTRIBUTION_PROVIDER,
  type LeadFlowCohortConversation,
  type LeadFlowCohortOpportunity,
} from '../leadflow-analytics/intelligence/leadflow-attribution-cohort.port';
import { DESTINATION_AT_PROVENANCE } from '../social-integrations/analytics/social-ad-destination-at';
import {
  SOCIAL_AD_HIERARCHY_PROVENANCE,
  type SocialAdHierarchyPath,
} from '../social-integrations/analytics/social-ad-hierarchy-lookup';
import { SocialAdDestinationHistoryReadService } from '../social-integrations/services/social-ad-destination-history.read.service';
import { destinationPairKey } from '../social-integrations/services/social-ad-destination-history.read.service';
import { SocialAdHierarchyLookupReadService } from '../social-integrations/services/social-ad-hierarchy-lookup.read.service';
import { SocialAnalyticsReadService } from '../social-integrations/services/social-analytics-read.service';
import { MESSAGING_PAID_MEDIA_DESTINATIONS } from '../social-integrations/sync/paid-media-destination';
import {
  OBSERVED_ATTRIBUTION_IMMATURE_COHORT_HOURS,
  OBSERVED_ATTRIBUTION_SUMMARY_ABSENCE_LIMITATION,
  OBSERVED_ATTRIBUTION_SUMMARY_CAUSALITY_LIMITATION,
  OBSERVED_ATTRIBUTION_SUMMARY_CONFLICT_LIMITATION,
  OBSERVED_ATTRIBUTION_SUMMARY_CURRENCY_LIMITATION,
  OBSERVED_ATTRIBUTION_SUMMARY_DESTINATION_LIMITATION,
  OBSERVED_ATTRIBUTION_SUMMARY_DESTINATION_NOT_ATTRIBUTION_LIMITATION,
  OBSERVED_ATTRIBUTION_SUMMARY_DESTINATION_UNAVAILABLE_LIMITATION,
  OBSERVED_ATTRIBUTION_SUMMARY_DESTINATION_UNUSUAL_LIMITATION,
  OBSERVED_ATTRIBUTION_SUMMARY_DESTINATION_VARIATION_LIMITATION,
  OBSERVED_ATTRIBUTION_SUMMARY_IMMATURE_LIMITATION,
  OBSERVED_ATTRIBUTION_SUMMARY_MESSAGING_MULTI_LIMITATION,
  OBSERVED_ATTRIBUTION_SUMMARY_OBSERVED_ONLY_LIMITATION,
  OBSERVED_ATTRIBUTION_SUMMARY_OPPORTUNITY_LIMITATION,
  OBSERVED_ATTRIBUTION_SUMMARY_PROJECTOR,
  OBSERVED_ATTRIBUTION_SUMMARY_PROVIDER_LIMITATION,
  OBSERVED_ATTRIBUTION_SUMMARY_SPEND_LIMITATION,
  OBSERVED_ATTRIBUTION_SUMMARY_UNRESOLVED_LIMITATION,
  OBSERVED_ATTRIBUTION_SUMMARY_VALUE_LIMITATION,
  type ObservedAttributionDestinationCoverage,
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
 *
 * ## I4.3: destination is an axis, not a level
 *
 * `groupBy=destination` groups the same matched conversations by where their ad
 * set pointed *at the moment of each click*, read from I4.1's observation
 * timeline. Two consequences follow and both are visible in the response:
 *
 * - The destination groups do not sum to `matchedConversations`. A conversation
 *   whose ad set was re-pointed between two of its own clicks has no single
 *   destination and enters no group — it is counted in
 *   `destinationTemporalVariationConversations` instead. Collapsing it would
 *   erase exactly the variation I4.1 exists to record.
 * - Destination never creates or widens an attribution. Every conversation here
 *   was already matched by its own observed ad id; the destination only
 *   describes where that ad pointed.
 */
@Injectable()
export class ObservedAttributionSummaryService {
  constructor(
    private readonly cohort: LeadFlowAttributionCohortAdapter,
    private readonly hierarchy: SocialAdHierarchyLookupReadService,
    // Only to resolve the connection's timezone, through the service that
    // already scopes connection lookups. No metric is read from it.
    private readonly socialReads: SocialAnalyticsReadService,
    // I4.1's destination timeline, read in batch. The same service the
    // per-conversation endpoint uses, so the two cannot disagree about what an
    // ad set pointed at when.
    private readonly destinations: SocialAdDestinationHistoryReadService,
    // I5's context dimension. Injected by class because an interface has no DI
    // token; only `BusinessModeDimensionPort`'s single method is used, and
    // nothing in this projector reads the value back — §12 forbids attribution
    // from becoming mode-aware.
    private readonly businessModes: BusinessModeDimensionAdapter,
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

    /**
     * Destination resolution and opportunities are independent reads over the
     * same matched set, so they go in parallel rather than in sequence.
     */
    const [opportunities, destinations, businessMode] = await Promise.all([
      this.cohort.cohortOpportunities(
        leadflowScope,
        matched.map((row) => row.conversationId),
      ),
      this.resolveDestinations(scope, matched, paths),
      // One row, once per request, for the whole response — the mode belongs to
      // the context and not to any conversation in it.
      this.businessModes.businessMode(scope),
    ]);

    const groups =
      groupBy === 'destination'
        ? buildDestinationGroups(matched, destinations, opportunities)
        : buildGroups(matched, paths, opportunities, groupBy);

    const destinationCoverage = summariseDestinationCoverage(
      matched.length,
      destinations,
    );
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
      destinationCoverage,
      businessMode,
      groups,
      provenance: {
        observation: LEADFLOW_COHORT_PROVENANCE.observation,
        conversation: LEADFLOW_COHORT_PROVENANCE.conversation,
        paidMedia: SOCIAL_AD_HIERARCHY_PROVENANCE,
        // §19: its own layer, never folded into `paidMedia`.
        destination: DESTINATION_AT_PROVENANCE,
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
        // §18: stated at every groupBy, so a reader comparing campaigns can see
        // how much of the cohort has resolvable destinations *before* switching
        // axes and reading partial groups as complete ones.
        destinationCoverage: destinationCoverage.destinationCoverage,
        destinationUnavailable:
          destinationCoverage.destinationUnavailableConversations,
        destinationTemporalVariation:
          destinationCoverage.destinationTemporalVariationConversations,
        businessMode: businessModeQuality(businessMode),
        limitations: limitationsFor({
          conflicting,
          unresolved,
          immatureCohort,
          currencyCompatibility,
          groups,
          destinationCoverage,
          destinations,
          businessMode,
        }),
      },
    };
  }

  /**
   * Every matched conversation's destination, resolved in one query.
   *
   * ## Why the pairs are flattened before asking
   *
   * Destination is per *observation*, so the question is really
   * `(ad set, instant)` — and a cohort of 50,000 conversations over 200 ad sets
   * asks that question 50,000 times about 200 rows of history. §30 forbids
   * issuing one query per conversation, and one query per ad set is still 200
   * round trips that grow with the account.
   *
   * So every conversation's instants are flattened into one pair list, the
   * batch method de-duplicates it (a hundred conversations that clicked the same
   * ad in the same second is one question), and a single query answers all of
   * them. The per-conversation folding then happens in memory over a map.
   *
   * ## Why a conversation with no ad set is not an error
   *
   * `destination_type` is an ad-set property in Meta's model. An ad whose parent
   * ad set never synced has nothing that could carry destination evidence, which
   * is a different state from "the ad set exists and we had not looked yet" —
   * and the coverage breakdown reports them separately for exactly that reason.
   */
  private async resolveDestinations(
    scope: IntelligenceScope,
    matched: LeadFlowCohortConversation[],
    paths: Map<string, SocialAdHierarchyPath>,
  ): Promise<Map<string, ConversationDestination>> {
    const resolved = new Map<string, ConversationDestination>();
    const pairs: { adEntityId: string; instant: string }[] = [];

    for (const conversation of matched) {
      const adsetEntityId = paths.get(
        conversation.distinctAdIds[0],
      )?.adsetEntityId;

      if (!adsetEntityId) continue;

      for (const instant of conversation.attributionInstants) {
        pairs.push({ adEntityId: adsetEntityId, instant });
      }
    }

    const readings = await this.destinations.destinationAtMany({
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      pairs,
    });

    for (const conversation of matched) {
      const adsetEntityId = paths.get(
        conversation.distinctAdIds[0],
      )?.adsetEntityId;

      if (!adsetEntityId) {
        resolved.set(conversation.conversationId, {
          state: 'adset_unresolved',
          value: null,
        });
        continue;
      }

      resolved.set(
        conversation.conversationId,
        foldDestination(
          conversation.attributionInstants.map((instant) =>
            readings.get(destinationPairKey(adsetEntityId, instant)),
          ),
        ),
      );
    }

    return resolved;
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
  const byConversation = groupOpportunities(opportunities);
  const accumulators = new Map<string, GroupAccumulator>();

  for (const conversation of conversations) {
    const path = paths.get(conversation.distinctAdIds[0]);
    if (!path) continue;

    const key = groupKey(path, groupBy);
    // A matched ad whose upper levels never synced has no key at that level.
    // Skipped rather than bucketed under a placeholder: an "unknown campaign"
    // row would be read as a real campaign that happens to be unnamed.
    if (!key) continue;

    const accumulator =
      accumulators.get(key) ?? newAccumulator(key, groupName(path, groupBy));

    accumulate(accumulator, conversation, byConversation);
    accumulators.set(key, accumulator);
  }

  return finaliseGroups(accumulators, groupBy);
}

/**
 * Opportunities indexed by the conversation they are explicitly linked to.
 *
 * Shared by both builders rather than written twice: the index is where §14's
 * "only `inbox_conversation_id`" rule becomes a lookup, and two copies is how a
 * later fallback gets added to one of them.
 */
function groupOpportunities(
  opportunities: LeadFlowCohortOpportunity[],
): Map<string, LeadFlowCohortOpportunity[]> {
  const byConversation = new Map<string, LeadFlowCohortOpportunity[]>();

  for (const opportunity of opportunities) {
    const list = byConversation.get(opportunity.conversationId) ?? [];
    list.push(opportunity);
    byConversation.set(opportunity.conversationId, list);
  }

  return byConversation;
}

function newAccumulator(key: string, name: string | null): GroupAccumulator {
  return {
    key,
    name,
    attributedConversations: 0,
    observationsCount: 0,
    qualifiedConversations: 0,
    opportunities: 0,
    wonOpportunities: 0,
    wonCents: 0n,
    currencies: new Set<string>(),
    valueParseable: true,
  };
}

/**
 * Adds one conversation to a group.
 *
 * Shared by the hierarchy and destination builders precisely so §11 holds: the
 * two axes must produce the *same* metrics with the same semantics, and the only
 * way to guarantee that is for both to run this code. A destination-specific
 * copy would be free to drift on won semantics or qualification counting, which
 * is the divergence §1 forbids.
 */
function accumulate(
  accumulator: GroupAccumulator,
  conversation: LeadFlowCohortConversation,
  byConversation: Map<string, LeadFlowCohortOpportunity[]>,
): void {
  accumulator.attributedConversations += 1;
  accumulator.observationsCount += conversation.observationsCount;

  // The *first* transition, and a conversation qualified twice still counts
  // once — `firstQualifiedAt` is a single instant by construction, so
  // re-qualification cannot double it.
  if (conversation.firstQualifiedAt !== null) {
    accumulator.qualifiedConversations += 1;
  }

  for (const opportunity of byConversation.get(conversation.conversationId) ??
    []) {
    accumulator.opportunities += 1;

    if (!opportunity.isWon) continue;

    accumulator.wonOpportunities += 1;
    if (opportunity.currency) accumulator.currencies.add(opportunity.currency);

    const cents = toCents(opportunity.valueAmount);
    if (cents === null) {
      accumulator.valueParseable = false;
    } else {
      accumulator.wonCents += cents;
    }
  }
}

function finaliseGroups(
  accumulators: Map<string, GroupAccumulator>,
  level: ObservedAttributionGroupBy,
): ObservedAttributionSummaryGroup[] {
  return [...accumulators.values()]
    .map((accumulator) => {
      const multiCurrency = accumulator.currencies.size > 1;
      const canTotal = !multiCurrency && accumulator.valueParseable;

      return {
        key: accumulator.key,
        level,
        name: accumulator.name,
        attributedConversations: accumulator.attributedConversations,
        observationsCount: accumulator.observationsCount,
        qualifiedConversations: accumulator.qualifiedConversations,
        opportunities: accumulator.opportunities,
        wonOpportunities: accumulator.wonOpportunities,
        // §16: unlike units are never added. Null is the honest answer, and it
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

/**
 * What one conversation's destination evidence adds up to.
 *
 * Four states, and they are four rather than "resolved or not" because each has
 * a different cause, a different remedy and a different honest thing to say
 * about it:
 *
 * - `resolved` — every reading that resolved agrees. The conversation joins that
 *   destination's group. `unknown` is a legitimate value here: Meta was asked
 *   and answered `UNDEFINED`, which is a real property of the ad set (§7's
 *   second cause, and 11 of 126 rows in production today).
 * - `temporal_variation` — the readings resolved to *different* destinations.
 *   §6: the attribution is fine, the evidence is good, and there are simply two
 *   true answers. No group, its own counter.
 * - `unavailable` — nothing resolved, because the destination observer had seen
 *   nothing about this ad set before the click (§7's first cause). Fixed by time
 *   passing, not by data quality work.
 * - `adset_unresolved` — the ad matched but its ad set never synced, so there is
 *   nothing that could carry destination evidence at all.
 */
type ConversationDestination = {
  state: 'resolved' | 'temporal_variation' | 'unavailable' | 'adset_unresolved';
  value: string | null;
};

/**
 * Folds one conversation's readings into its single answer.
 *
 * The branch order *is* the semantics, and it mirrors I4.1's `summariseDestination`
 * deliberately — the aggregate must not fold differently from the per-conversation
 * view, or the same conversation would read as `whatsapp` in one and
 * `temporal_variation` in the other.
 *
 * A partial resolve — some instants before the observer began, some after —
 * decides on the *resolved* readings alone. An unresolved instant is an absence
 * of evidence, not evidence of a different destination, and treating it as
 * variation would manufacture a conflict out of a gap.
 */
function foldDestination(
  readings: ReadonlyArray<{ value: string; resolution: string } | undefined>,
): ConversationDestination {
  const observed = readings.filter(
    (reading): reading is { value: string; resolution: string } =>
      reading !== undefined && reading.resolution === 'observed_destination',
  );

  if (!observed.length) return { state: 'unavailable', value: null };

  const distinct = [...new Set(observed.map((reading) => reading.value))];

  if (distinct.length > 1) {
    return { state: 'temporal_variation', value: null };
  }

  return { state: 'resolved', value: distinct[0] };
}

/**
 * Folds matched conversations into one row per canonical destination.
 *
 * Same counting rule as `buildGroups` and the same loop shape enforcing it: the
 * iteration is over conversations, so each contributes one to
 * `attributedConversations` no matter how many observations or opportunities it
 * carries (§12).
 *
 * The one structural difference from the hierarchy builder is what gets skipped.
 * There, a missing key means the upper level never synced. Here, a skipped
 * conversation is a *semantic* refusal: `temporal_variation` has perfectly good
 * evidence and is deliberately placed nowhere, because placing it would require
 * choosing between two readings that are both true.
 */
function buildDestinationGroups(
  conversations: LeadFlowCohortConversation[],
  destinations: Map<string, ConversationDestination>,
  opportunities: LeadFlowCohortOpportunity[],
): ObservedAttributionSummaryGroup[] {
  const byConversation = groupOpportunities(opportunities);
  const accumulators = new Map<string, GroupAccumulator>();

  for (const conversation of conversations) {
    const destination = destinations.get(conversation.conversationId);

    // Only a conversation with one destination true across all its evidence
    // enters a group. The other three states are counted in coverage, never
    // distributed across buckets (§5).
    if (destination?.state !== 'resolved' || destination.value === null) {
      continue;
    }

    const accumulator =
      accumulators.get(destination.value) ??
      // `name` is null: for a destination the key already *is* the readable
      // value, and a label here would become a second thing to match on.
      newAccumulator(destination.value, null);

    accumulate(accumulator, conversation, byConversation);
    accumulators.set(destination.value, accumulator);
  }

  return finaliseGroups(accumulators, 'destination');
}

/**
 * The destination enrichment breakdown (§17).
 *
 * Every matched conversation lands in exactly one of the four states, so the
 * parts sum back to `matchedConversations` — which is what makes the figure
 * auditable rather than a bare percentage a reader has to trust.
 */
function summariseDestinationCoverage(
  matchedConversations: number,
  destinations: Map<string, ConversationDestination>,
): ObservedAttributionDestinationCoverage {
  let resolved = 0;
  let unavailable = 0;
  let variation = 0;
  let adsetUnresolved = 0;

  for (const destination of destinations.values()) {
    if (destination.state === 'resolved') resolved += 1;
    else if (destination.state === 'temporal_variation') variation += 1;
    else if (destination.state === 'unavailable') unavailable += 1;
    else adsetUnresolved += 1;
  }

  return {
    matchedConversations,
    destinationResolvedConversations: resolved,
    destinationUnavailableConversations: unavailable,
    destinationTemporalVariationConversations: variation,
    destinationAdsetUnresolvedConversations: adsetUnresolved,
    // Undefined rather than zero on an empty cohort, identically to
    // `observedCoverage` — nothing to enrich is not failed enrichment.
    destinationCoverage: matchedConversations
      ? resolved / matchedConversations
      : null,
  };
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

/**
 * The hierarchy key at a level.
 *
 * `destination` never reaches here — it is dispatched to its own builder before
 * this is called, because its key comes from the destination timeline rather
 * than from the ad's path. Returning null for it keeps the function total
 * without inventing a hierarchy answer for an axis that has none.
 */
function groupKey(
  path: SocialAdHierarchyPath,
  groupBy: ObservedAttributionGroupBy,
): string | null {
  if (groupBy === 'ad') return path.adId;
  if (groupBy === 'adset') return path.adsetId;
  if (groupBy === 'campaign') return path.campaignId;
  if (groupBy === 'account') return path.accountId;

  return null;
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
  destinationCoverage: ObservedAttributionDestinationCoverage;
  destinations: Map<string, ConversationDestination>;
  businessMode: BusinessModeDimension;
}): string[] {
  const limitations = [
    OBSERVED_ATTRIBUTION_SUMMARY_OBSERVED_ONLY_LIMITATION,
    OBSERVED_ATTRIBUTION_SUMMARY_PROVIDER_LIMITATION,
    OBSERVED_ATTRIBUTION_SUMMARY_ABSENCE_LIMITATION,
    OBSERVED_ATTRIBUTION_SUMMARY_CAUSALITY_LIMITATION,
    OBSERVED_ATTRIBUTION_SUMMARY_OPPORTUNITY_LIMITATION,
    OBSERVED_ATTRIBUTION_SUMMARY_SPEND_LIMITATION,
    // Both unconditional: they describe what a destination figure *is* and what
    // it is not, and a reader needs that before the first number — not only
    // once some threshold of odd data has been crossed.
    OBSERVED_ATTRIBUTION_SUMMARY_DESTINATION_LIMITATION,
    OBSERVED_ATTRIBUTION_SUMMARY_DESTINATION_NOT_ATTRIBUTION_LIMITATION,
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

  if (
    input.destinationCoverage.destinationUnavailableConversations > 0 ||
    input.destinationCoverage.destinationAdsetUnresolvedConversations > 0
  ) {
    limitations.push(
      OBSERVED_ATTRIBUTION_SUMMARY_DESTINATION_UNAVAILABLE_LIMITATION,
    );
  }

  if (input.destinationCoverage.destinationTemporalVariationConversations > 0) {
    limitations.push(
      OBSERVED_ATTRIBUTION_SUMMARY_DESTINATION_VARIATION_LIMITATION,
    );
  }

  const values = [...input.destinations.values()];

  // §10: stated whenever the bucket is actually populated, because that is when
  // a reader is about to interpret it — and the thing they will otherwise
  // assume is that these conversations are WhatsApp's, since that is where they
  // arrived.
  if (values.some((destination) => destination.value === 'messaging_multi')) {
    limitations.push(OBSERVED_ATTRIBUTION_SUMMARY_MESSAGING_MULTI_LIMITATION);
  }

  // §9: flagged, never discarded and never called an error. A conversation
  // attributed to an ad whose ad set pointed at a website is a possible fact.
  if (
    values.some(
      (destination) =>
        destination.state === 'resolved' &&
        destination.value !== null &&
        destination.value !== 'unknown' &&
        !MESSAGING_PAID_MEDIA_DESTINATIONS.has(
          destination.value as Parameters<
            typeof MESSAGING_PAID_MEDIA_DESTINATIONS.has
          >[0],
        ),
    )
  ) {
    limitations.push(
      OBSERVED_ATTRIBUTION_SUMMARY_DESTINATION_UNUSUAL_LIMITATION,
    );
  }

  // I5 §24, on the same condition I3 uses: the sentence warns that a label may
  // not describe the queried period, and an absent label cannot be misdated.
  if (input.businessMode.resolution !== 'unconfigured') {
    limitations.push(BUSINESS_MODE_CURRENT_ONLY_LIMITATION);
  }

  if (input.businessMode.resolution === 'unknown_key') {
    limitations.push(BUSINESS_MODE_UNKNOWN_KEY_LIMITATION);
  }

  return limitations;
}
