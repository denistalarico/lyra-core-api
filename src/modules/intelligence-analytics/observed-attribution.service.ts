import { Injectable } from '@nestjs/common';
import type { IntelligenceScope } from '../../common/intelligence';
import { LeadFlowAttributionAdapter } from '../leadflow-analytics/intelligence/leadflow-attribution.adapter';
import {
  LEADFLOW_ATTRIBUTION_PROVENANCE,
  type LeadFlowAttributionObservation,
  type LeadFlowAttributionOpportunity,
  type LeadFlowConversationAttribution,
} from '../leadflow-analytics/intelligence/leadflow-attribution.port';
import {
  DESTINATION_AT_PROVENANCE,
  DESTINATION_UNAVAILABLE,
} from '../social-integrations/analytics/social-ad-destination-at';
import {
  SOCIAL_AD_HIERARCHY_PROVENANCE,
  type SocialAdHierarchyPath,
} from '../social-integrations/analytics/social-ad-hierarchy-lookup';
import { SocialAdDestinationHistoryReadService } from '../social-integrations/services/social-ad-destination-history.read.service';
import { SocialAdHierarchyLookupReadService } from '../social-integrations/services/social-ad-hierarchy-lookup.read.service';
import {
  OBSERVED_ATTRIBUTION_AMBIGUOUS_LIMITATION,
  OBSERVED_ATTRIBUTION_CAUSALITY_LIMITATION,
  OBSERVED_ATTRIBUTION_CLICK_ID_LIMITATION,
  OBSERVED_ATTRIBUTION_CONFLICT_LIMITATION,
  OBSERVED_ATTRIBUTION_DESTINATION_HISTORY_LIMITATION,
  OBSERVED_ATTRIBUTION_DESTINATION_MULTI_LIMITATION,
  OBSERVED_ATTRIBUTION_DESTINATION_OBSERVED_LIMITATION,
  OBSERVED_ATTRIBUTION_DESTINATION_UNDEFINED_LIMITATION,
  OBSERVED_ATTRIBUTION_DESTINATION_VARIATION_LIMITATION,
  OBSERVED_ATTRIBUTION_NOT_FOUND_LIMITATION,
  OBSERVED_ATTRIBUTION_NO_BACKFILL_LIMITATION,
  OBSERVED_ATTRIBUTION_PROJECTOR,
  OBSERVED_ATTRIBUTION_PROVIDER_LIMITATION,
  OBSERVED_ATTRIBUTION_VALUE_LIMITATION,
  type ObservedAttributionDestination,
  type ObservedAttributionDestinationReading,
  type ObservedAttributionEvidence,
  type ObservedAttributionMatchStatus,
  type ObservedAttributionOutcomes,
  type ObservedAttributionView,
} from './observed-attribution.contract';

/**
 * The provider whose referral this layer resolves.
 *
 * `meta` is what the WhatsApp adapter writes into `provider` on the
 * observation; `meta_ads` is what the Social mirror stores. They are different
 * strings for the same company because they were named by different domains,
 * and the bridge is the one place that has to know both.
 */
const SUPPORTED_OBSERVATION_PROVIDER = 'meta';

/**
 * The channel type that actually carries an ad id today.
 *
 * Instagram Direct and Messenger produce no referral at all — verified against
 * their adapters, neither of which reads a referral block. A conversation from
 * those channels reports `unsupported_provider` rather than `no_ad_id`, because
 * the two mean different things to whoever reads the report: `no_ad_id` says
 * "this conversation did not come from an ad", and that would be a claim the
 * evidence cannot support.
 */
const SUPPORTED_CHANNEL_TYPE = 'whatsapp';

/**
 * The individual half of the acquisition picture.
 *
 * I3 answers "how much did we spend and how many deals closed in this period",
 * and is explicit that it correlates rather than attributes. This answers a
 * narrower question with far stronger evidence: *this* conversation began after
 * a click on *this* ad, because the provider said so on the inbound message.
 *
 * It shares I3's architecture and none of its machinery. In particular it does
 * not read the cohort: attributing a conversation by finding spend on the same
 * day and channel is precisely the inference the cohort view refuses to make,
 * and building on it would launder a correlation into an "observed" label.
 *
 * ## No metrics dependency
 *
 * Nothing here touches `social_ad_metrics_daily`. That is a deliberate
 * independence, not an omission: on this deployment ad-set metrics have not
 * been ingested at all, and a conversation carrying a valid ad id is still
 * attributable to that ad. Attribution answers "where did this come from"; the
 * fact tables answer "what did it cost". Coupling them would make the first
 * question unanswerable whenever a backfill had not run.
 */
@Injectable()
export class ObservedAttributionService {
  constructor(
    private readonly leadflow: LeadFlowAttributionAdapter,
    private readonly hierarchy: SocialAdHierarchyLookupReadService,
    // I4.1. The same service I3.2a's timeline lives on — one table, one owner
    // — reached through a point-in-time method rather than the day-cut one.
    private readonly destinations: SocialAdDestinationHistoryReadService,
  ) {}

  /**
   * Returns null when the conversation is not visible in this scope.
   *
   * The controller turns that into a 404. It is not `scope_mismatch`: a status
   * distinguishing "exists but not yours" from "does not exist" would confirm
   * the existence of another tenant's conversation to anyone who guessed an id.
   */
  async conversation(
    scope: IntelligenceScope,
    conversationId: string,
  ): Promise<ObservedAttributionView | null> {
    const leadflowScope = {
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      contextType: scope.agencyClientId
        ? ('client' as const)
        : ('agency' as const),
      clientId: scope.agencyClientId,
    };

    const attribution = await this.leadflow.conversationAttribution(
      leadflowScope,
      conversationId,
    );

    if (!attribution.exists) return null;

    // Only now, and only for a conversation already proven visible. The
    // opportunity read is issued alongside the hierarchy lookup because neither
    // depends on the other's answer.
    const [opportunities, resolution] = await Promise.all([
      this.leadflow.conversationOpportunities(leadflowScope, conversationId),
      this.resolvePaidMedia(scope, attribution),
    ]);

    const outcomes = summariseOutcomes(opportunities);
    const matchStatus = resolution.status;
    const matched = matchStatus === 'matched';

    /**
     * I4.1, and only for a match.
     *
     * A conversation with conflicting ads gets no destination block at all: it
     * has no single ad set, and producing "the" destination for two different
     * ads would be the arbitrary choice §11 forbids. The per-observation
     * evidence is already in `evidence`, so nothing is hidden.
     */
    const destination =
      matched && resolution.path
        ? await this.resolveDestination(scope, attribution, resolution.path)
        : null;

    const paidMedia = resolution.paidMedia
      ? { ...resolution.paidMedia, destination }
      : null;

    return {
      kind: 'observed_attribution',
      conversation: {
        conversationId,
        firstObservedAt: attribution.firstObservedAt,
        lastObservedAt: attribution.lastObservedAt,
        observationCount: attribution.observations.length,
        distinctAdIds: attribution.distinctAdIds,
        consistency: attribution.consistency,
        firstQualifiedAt: attribution.firstQualifiedAt,
      },
      evidence: attribution.observations.map(toEvidence),
      paidMedia: matched ? paidMedia : null,
      outcomes,
      matchStatus,
      ambiguousConnectionIds: resolution.ambiguousConnectionIds,
      provenance: {
        observation: LEADFLOW_ATTRIBUTION_PROVENANCE.observation,
        conversation: LEADFLOW_ATTRIBUTION_PROVENANCE.conversation,
        paidMedia: SOCIAL_AD_HIERARCHY_PROVENANCE,
        destination: DESTINATION_AT_PROVENANCE,
        qualification: LEADFLOW_ATTRIBUTION_PROVENANCE.qualification,
        opportunity: LEADFLOW_ATTRIBUTION_PROVENANCE.opportunity,
        projector: OBSERVED_ATTRIBUTION_PROJECTOR,
      },
      dataQuality: {
        // The one place this flag is set, and it is set from the match alone.
        // I4.1 does not touch it: a destination that could not be resolved says
        // nothing about whether the ad was observed.
        individualAttribution: matched,
        providerEvidence: attribution.observations.length > 0,
        hierarchyResolved: matched,
        opportunityLinkExplicit: outcomes.opportunityCount > 0,
        attributionConflict: attribution.consistency === 'conflicting',
        // Every instant, not merely one. A conversation whose second click
        // resolved and whose first predates the history is *partially*
        // resolved, and reporting `true` there would let a consumer render the
        // destination as if it covered the whole conversation.
        destinationResolved:
          destination !== null &&
          destination.readings.length > 0 &&
          destination.readings.every(
            (reading) => reading.resolution === 'observed_destination',
          ),
        destinationTemporalEvidence:
          destination !== null &&
          destination.readings.some(
            (reading) => reading.resolution === 'observed_destination',
          ),
        destinationConsistency: destination?.consistency ?? 'unavailable',
        limitations: limitationsFor(
          matchStatus,
          attribution,
          outcomes,
          destination,
        ),
      },
    };
  }

  /**
   * The ad set's destination as of each piece of evidence that carried the ad.
   *
   * ## Which instants, and why not `firstObservedAt`
   *
   * The instants come from the observations that actually named the matched ad
   * id — not from the conversation's first or last observation. Those two are
   * properties of the *conversation*, and on a thread whose first message
   * carried no referral, `firstObservedAt` would date the destination to a
   * moment that has nothing to do with the ad. Tying each reading to the
   * observation it belongs to is also what makes `temporal_variation`
   * reportable instead of a silent collapse.
   *
   * ## Why the ad set and not the ad
   *
   * `destination_type` is an ad-set property in Meta's model, which I3.2
   * established by omission: the field is absent from the ad payload entirely.
   * So an ad with no resolved ad set has no destination to report, and says so
   * rather than reaching for the campaign's or the account's.
   */
  private async resolveDestination(
    scope: IntelligenceScope,
    attribution: LeadFlowConversationAttribution,
    path: SocialAdHierarchyPath,
  ): Promise<ObservedAttributionDestination | null> {
    if (!path.adsetEntityId) return null;

    const carriers = attribution.observations.filter(
      (row) => row.adId === path.adId,
    );

    if (!carriers.length) return null;

    const resolved = await this.destinations.destinationAt({
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      adEntityId: path.adsetEntityId,
      instants: carriers.map((row) => row.observedAt),
    });

    const readings: ObservedAttributionDestinationReading[] = carriers.map(
      (carrier) => {
        const at = resolved.get(carrier.observedAt) ?? DESTINATION_UNAVAILABLE;

        return {
          observationId: carrier.observationId,
          attributionObservedAt: carrier.observedAt,
          value: at.value,
          resolution: at.resolution,
          destinationObservedAt: at.observedAt,
          raw: at.raw,
        };
      },
    );

    return summariseDestination(readings);
  }

  /**
   * Decides the match status and, when it can, the hierarchy path.
   *
   * The ordering of these checks is the semantics, and each earlier case would
   * be misreported by a later one:
   *
   * 1. A conflict is answered before any lookup. Two different ads were
   *    genuinely clicked, and resolving either would present one real click as
   *    *the* origin.
   * 2. No ad id at all — nothing to look up.
   * 3. Evidence from a channel that cannot carry an ad id is `unsupported`,
   *    not `no_ad_id`, so the report never implies a conversation was organic
   *    when the channel simply cannot tell us.
   */
  private async resolvePaidMedia(
    scope: IntelligenceScope,
    attribution: LeadFlowConversationAttribution,
  ): Promise<{
    status: ObservedAttributionMatchStatus;
    paidMedia: ObservedAttributionView['paidMedia'];
    path: SocialAdHierarchyPath | null;
    ambiguousConnectionIds: string[];
  }> {
    const miss = (status: ObservedAttributionMatchStatus) => ({
      status,
      paidMedia: null,
      // The raw hierarchy row, carried separately from the response shape so
      // the destination lookup can use the ad set's internal id without that
      // join key leaking into the rendered output.
      path: null,
      ambiguousConnectionIds: [],
    });

    if (attribution.consistency === 'conflicting') {
      return miss('conflicting_observations');
    }

    const [adId] = attribution.distinctAdIds;

    if (!adId) {
      return miss(
        attribution.observations.some(isUnsupportedSource)
          ? 'unsupported_provider'
          : 'no_ad_id',
      );
    }

    // The observation that carries the id decides whether we can resolve it.
    // A future provider will reach this line with its own strings and must be
    // added deliberately rather than resolved against Meta's mirror by default.
    const carrier = attribution.observations.find((row) => row.adId === adId);

    if (carrier && isUnsupportedSource(carrier)) {
      return miss('unsupported_provider');
    }

    const result = await this.hierarchy.lookup({
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      agencyClientId: scope.agencyClientId,
      adId,
    });

    if (result.status !== 'matched') {
      return {
        status: result.status,
        paidMedia: null,
        path: null,
        // Only ambiguity has candidates to report; `ad_not_found` returns an
        // empty list from the lookup, so this needs no branch of its own.
        ambiguousConnectionIds: result.candidateConnectionIds,
      };
    }

    return {
      status: 'matched',
      paidMedia: {
        connectionId: result.path.connectionId,
        accountId: result.path.accountId,
        campaignId: result.path.campaignId,
        adsetId: result.path.adsetId,
        adId: result.path.adId,
        adName: result.path.adName,
        adsetName: result.path.adsetName,
        campaignName: result.path.campaignName,
        // Filled by the caller once the destination is resolved.
        destination: null,
      },
      path: result.path,
      ambiguousConnectionIds: [],
    };
  }
}

/**
 * Folds the per-observation readings into the conversation's answer.
 *
 * The ordering of the branches is the semantics:
 *
 * 1. Nothing resolved at all → `unavailable`, and no value is stated.
 * 2. More than one distinct destination resolved → `temporal_variation`, and
 *    `value` stays **null**. The ad never changed; where it pointed did, and
 *    both readings are true of their own moment. Naming one would be exactly
 *    the collapse the separate vocabulary exists to prevent.
 * 3. Otherwise one destination stands for the whole conversation.
 *
 * A partial resolve — some instants before the history begins, some after —
 * falls into (2) or (3) on the *resolved* ones alone, because an unresolved
 * instant is not evidence of a different destination. It is still visible as a
 * reading, and `destinationResolved` is false whenever any reading failed.
 */
function summariseDestination(
  readings: ObservedAttributionDestinationReading[],
): ObservedAttributionDestination {
  const observed = readings.filter(
    (reading) => reading.resolution === 'observed_destination',
  );

  if (!observed.length) {
    return {
      value: null,
      resolution: 'unavailable_before_first_observation',
      observedAt: null,
      raw: null,
      consistency: 'unavailable',
      readings,
    };
  }

  const distinct = [...new Set(observed.map((reading) => reading.value))];

  if (distinct.length > 1) {
    return {
      value: null,
      resolution: 'temporal_variation',
      observedAt: null,
      raw: null,
      consistency: 'temporal_variation',
      readings,
    };
  }

  // One destination across every resolved instant. The representative reading
  // is the latest one — its `destinationObservedAt` is the freshest evidence
  // for the value they all agree on.
  const latest = observed[observed.length - 1];

  return {
    value: latest.value,
    resolution: 'observed_destination',
    observedAt: latest.destinationObservedAt,
    raw: latest.raw,
    consistency: observed.length > 1 ? 'multiple_consistent' : 'single',
    readings,
  };
}

function isUnsupportedSource(
  observation: LeadFlowAttributionObservation,
): boolean {
  return (
    observation.provider !== SUPPORTED_OBSERVATION_PROVIDER ||
    observation.channelType !== SUPPORTED_CHANNEL_TYPE
  );
}

function toEvidence(
  observation: LeadFlowAttributionObservation,
): ObservedAttributionEvidence {
  return {
    observationId: observation.observationId,
    messageId: observation.messageId,
    provider: observation.provider,
    channelType: observation.channelType,
    adId: observation.adId,
    clickIdPresent: observation.clickId !== null,
    sourceType: observation.sourceType,
    observedAt: observation.observedAt,
  };
}

/**
 * Counts and totals the explicitly linked opportunities.
 *
 * `wonOpportunityValue` is null rather than a sum whenever the won deals span
 * more than one currency — the same refusal the LeadFlow fact adapter makes,
 * and for the stronger reason here: a per-conversation card showing one number
 * gives no hint that two units were added.
 */
function summariseOutcomes(
  opportunities: LeadFlowAttributionOpportunity[],
): ObservedAttributionOutcomes {
  const won = opportunities.filter((row) => row.isWon);
  const currencies = new Set(
    won.map((row) => row.currency).filter((value): value is string => !!value),
  );
  const canTotal = currencies.size <= 1;

  // Scaled-integer arithmetic. `value_amount` is numeric in the database and
  // arrives as a string; parsing to a double and adding would drift on exactly
  // the two-decimal values a deal amount actually takes.
  let totalCents = 0n;
  let parseable = true;

  for (const row of won) {
    const cents = toCents(row.valueAmount);
    if (cents === null) {
      parseable = false;
      break;
    }
    totalCents += cents;
  }

  return {
    opportunities: opportunities.map((row) => ({
      opportunityId: row.opportunityId,
      status: row.status,
      isWon: row.isWon,
      wonAt: row.wonAt,
      opportunityValue: row.valueAmount,
      currency: row.currency,
    })),
    opportunityCount: opportunities.length,
    wonOpportunityCount: won.length,
    wonOpportunityValue: canTotal && parseable ? formatCents(totalCents) : null,
    currency: currencies.size === 1 ? [...currencies][0] : null,
  };
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
 * Conditional rather than a fixed block: a reader who sees the same eight
 * caveats on every response stops reading them, and the one that actually
 * explains their result is lost among seven that do not.
 */
function limitationsFor(
  status: ObservedAttributionMatchStatus,
  attribution: LeadFlowConversationAttribution,
  outcomes: ObservedAttributionOutcomes,
  destination: ObservedAttributionDestination | null,
): string[] {
  const limitations: string[] = [];

  if (status === 'matched') {
    limitations.push(OBSERVED_ATTRIBUTION_CAUSALITY_LIMITATION);
  }

  if (status === 'conflicting_observations') {
    limitations.push(OBSERVED_ATTRIBUTION_CONFLICT_LIMITATION);
  }

  if (status === 'ad_not_found') {
    limitations.push(OBSERVED_ATTRIBUTION_NOT_FOUND_LIMITATION);
  }

  if (status === 'ambiguous_connection') {
    limitations.push(OBSERVED_ATTRIBUTION_AMBIGUOUS_LIMITATION);
  }

  if (status === 'unsupported_provider') {
    limitations.push(OBSERVED_ATTRIBUTION_PROVIDER_LIMITATION);
  }

  // A click id with no ad id is the one case where evidence exists and this
  // layer still cannot attribute, which is worth saying explicitly rather than
  // leaving as a bare `no_ad_id`.
  if (
    attribution.observations.some((row) => row.clickId && !row.adId) &&
    attribution.distinctAdIds.length === 0
  ) {
    limitations.push(OBSERVED_ATTRIBUTION_CLICK_ID_LIMITATION);
  }

  if (attribution.observations.length === 0) {
    limitations.push(OBSERVED_ATTRIBUTION_NO_BACKFILL_LIMITATION);
  }

  if (outcomes.wonOpportunityCount > 0) {
    limitations.push(OBSERVED_ATTRIBUTION_VALUE_LIMITATION);
  }

  // I4.1. Conditional for the same reason the rest are: a reader who sees the
  // same caveats on every response stops reading them.
  if (destination) {
    if (destination.consistency === 'unavailable') {
      limitations.push(OBSERVED_ATTRIBUTION_DESTINATION_HISTORY_LIMITATION);
    } else {
      // Applies to every resolved destination, and it is the important one: the
      // value is the last *observation* before the conversation, not the
      // destination in force at that instant.
      limitations.push(OBSERVED_ATTRIBUTION_DESTINATION_OBSERVED_LIMITATION);
    }

    if (destination.consistency === 'temporal_variation') {
      limitations.push(OBSERVED_ATTRIBUTION_DESTINATION_VARIATION_LIMITATION);
    }

    // A partial resolve carries both: some evidence stands, some predates the
    // history entirely.
    if (
      destination.consistency !== 'unavailable' &&
      destination.readings.some(
        (reading) => reading.resolution !== 'observed_destination',
      )
    ) {
      limitations.push(OBSERVED_ATTRIBUTION_DESTINATION_HISTORY_LIMITATION);
    }

    // Meta was asked and answered "nothing configured" — a different fact from
    // never having looked, and only `raw` distinguishes them.
    if (destination.readings.some((reading) => reading.raw === 'UNDEFINED')) {
      limitations.push(OBSERVED_ATTRIBUTION_DESTINATION_UNDEFINED_LIMITATION);
    }

    if (
      destination.readings.some(
        (reading) => reading.value === 'messaging_multi',
      )
    ) {
      limitations.push(OBSERVED_ATTRIBUTION_DESTINATION_MULTI_LIMITATION);
    }
  }

  return limitations;
}
