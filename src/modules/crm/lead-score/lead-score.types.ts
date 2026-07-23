/**
 * Contracts for the CRM's deterministic lead score.
 *
 * The score belongs to the opportunity, never to the contact: one person may be
 * pursuing two unrelated deals, and collapsing them would let progress on one
 * silently qualify the other.
 *
 * Nothing here computes anything. The engine is a pure function of a policy and
 * a set of features loaded from canonical sources, which is what makes a stored
 * verdict reproducible: given the same features and the same policy version,
 * the same number comes out.
 */

/** Rules the pretended policy names. Not all of them can run yet. */
export enum LeadScoreRuleId {
  /** The lead arrived through an active channel rather than manual entry. */
  ChannelOrigin = 'channel_origin',
  /** Every field the Business Mode declares as necessary is filled in. */
  QualificationFields = 'qualification_fields',
  /** The lead answered at least once. */
  LeadReplied = 'lead_replied',
  /** The lead sent at least three inbound messages. */
  EngagedConversation = 'engaged_conversation',
  CommercialIntent = 'commercial_intent',
  PriceRequest = 'price_request',
  MeetingAccepted = 'meeting_accepted',
  FollowupUnanswered = 'followup_unanswered',
  MeetingNoShow = 'meeting_no_show',
  NoInterest = 'no_interest',
  OptOutOrInvalid = 'opt_out_or_invalid',
  LostOrDiscarded = 'lost_or_discarded',
}

/**
 * Whether a rule can run at all.
 *
 * Declared on the rule itself, so a policy is honest about its own coverage
 * before anything is evaluated. Only `active` rules ever contribute points.
 */
export type LeadScoreRuleAvailability =
  /** A canonical source exists and the rule participates in the score. */
  | 'active'
  /** The domain or event that would feed it is still to be built. */
  | 'planned'
  /** The dependency should exist but is not currently usable. */
  | 'unavailable';

/** Outcome of evaluating one rule against one opportunity. */
export type LeadScoreRuleOutcome =
  /** Evaluated and the condition held; points applied. */
  | 'contributed'
  /** Evaluated and the condition did not hold; no points. */
  | 'not_met'
  /** Cannot apply to this record at all (no conversation, for instance). */
  | 'not_applicable'
  /** The rule is not part of this policy's active set. */
  | 'planned'
  /** Should have been evaluable and was not. Never scored as zero silently. */
  | 'unavailable';

export type LeadScoreBand = 'cold' | 'warm' | 'hot';

/** How a rule affects the total. */
export type LeadScoreRuleKind =
  /** Adds or subtracts points. */
  | 'contribution'
  /** Forces the whole score to a fixed value, ignoring contributions. */
  | 'terminal_override';

/** Structured inputs a rule may consult. Never message text. */
export enum LeadScoreFeatureKey {
  OriginatedFromChannel = 'originated_from_channel',
  ConversationLinked = 'conversation_linked',
  InboundMessageCount = 'inbound_message_count',
  EssentialFieldsTotal = 'essential_fields_total',
  EssentialFieldsPresent = 'essential_fields_present',
  LifecycleStatus = 'lifecycle_status',
  StageIsLost = 'stage_is_lost',
}

/**
 * A loaded feature, or the reason it could not be loaded.
 *
 * Absence is never a value. A rule whose feature is unavailable reports
 * `unavailable` rather than quietly scoring zero, because "we could not tell"
 * and "the answer is no" mean different things to whoever reads the score.
 */
export type LeadScoreFeature =
  | { available: true; value: number | boolean | string; observedAt: string }
  | { available: false; reason: LeadScoreFeatureGap };

export type LeadScoreFeatureGap =
  /** The opportunity has no canonical link to the record that holds it. */
  | 'no_canonical_link'
  /** The Business Mode could not be resolved, so its fields are unknown. */
  | 'business_mode_unresolved'
  /** The owning domain does not produce this signal yet. */
  | 'not_produced';

export type LeadScoreFeatureSet = Partial<
  Record<LeadScoreFeatureKey, LeadScoreFeature>
>;

export interface LeadScoreRuleSpec {
  id: LeadScoreRuleId;
  /** Operator-facing name. Shown in the breakdown. */
  label: string;
  /** Points this rule can contribute. Negative for penalties. */
  points: number;
  kind: LeadScoreRuleKind;
  /** Value the score is forced to. Only for `terminal_override`. */
  overrideScore?: number;
  availability: LeadScoreRuleAvailability;
  group:
    | 'profile'
    | 'engagement'
    | 'intent'
    | 'conversion'
    | 'progress'
    | 'penalty'
    | 'terminal';
  /** Domain that owns the signal. The CRM owns the score, not the signals. */
  owningDomain: string;
  /** Features the rule consults. Drives demand-driven loading. */
  features: LeadScoreFeatureKey[];
  /** Why it is not active. Required whenever availability is not `active`. */
  blockedReason?: string;
}

export interface LeadScoreBandRange {
  band: LeadScoreBand;
  min: number;
  max: number;
}

/**
 * A complete, versioned scoring policy.
 *
 * Bands are deliberately part of the policy but fixed across versions: if a
 * later policy moved them, snapshots taken under different versions would stop
 * being comparable, which would destroy the historical record the Analytics
 * work is meant to be built on. What changes between versions is which rules
 * are active — and therefore `maxAchievable`, which every snapshot records so a
 * later reader can normalise.
 */
export interface LeadScorePolicy {
  policyVersion: string;
  featureSchemaVersion: string;
  minScore: number;
  maxScore: number;
  bands: LeadScoreBandRange[];
  rules: LeadScoreRuleSpec[];
}

/**
 * Supplies the policy in force.
 *
 * An abstraction rather than a constant so a future Analytics-published policy
 * can replace the static one without the engine changing: the engine must never
 * read scattered weights directly.
 */
export interface LeadScorePolicyProvider {
  /** Policy for this tenant/workspace. V1 ignores scope and returns one. */
  getActivePolicy(scope: {
    tenantId: string;
    workspaceId: string;
    businessModeKey?: string | null;
  }): Promise<LeadScorePolicy>;
}

export const LEAD_SCORE_POLICY_PROVIDER = Symbol('LEAD_SCORE_POLICY_PROVIDER');

/** One rule's contribution, recorded so a score can be explained afterwards. */
export interface LeadScoreBreakdownEntry {
  ruleId: LeadScoreRuleId;
  label: string;
  policyVersion: string;
  outcome: LeadScoreRuleOutcome;
  /** Structured observation. Counts, booleans, ids — never message content. */
  observed: Record<string, number | boolean | string | null>;
  possiblePoints: number;
  appliedPoints: number;
  /** Machine-readable explanation of the outcome. */
  reasonCode: string;
  owningDomain: string;
  /** References that let an auditor find the evidence. No payload content. */
  evidence: string[];
}

/** Why a recalculation happened. */
export type LeadScoreCalculationReason =
  | 'opportunity_created'
  | 'opportunity_updated'
  | 'stage_changed'
  | 'lifecycle_changed'
  | 'conversation_linked'
  | 'inbound_message'
  | 'manual_recalculation'
  | 'backfill';

export interface LeadScoreCalculation {
  score: number;
  band: LeadScoreBand;
  policyVersion: string;
  featureSchemaVersion: string;
  /**
   * Highest score the active rules of this policy could produce. Recorded so a
   * reader can tell "cold because the lead is cold" from "cold because the
   * platform can only measure 45 points today".
   */
  maxAchievable: number;
  breakdown: LeadScoreBreakdownEntry[];
  features: LeadScoreFeatureSet;
  terminalOverride: LeadScoreRuleId | null;
  calculatedAt: Date;
}

/** Resolves the band a score falls into. */
export function resolveBand(
  policy: LeadScorePolicy,
  score: number,
): LeadScoreBand {
  const match = policy.bands.find(
    (range) => score >= range.min && score <= range.max,
  );
  return match?.band ?? 'cold';
}

/** Total of the positive points every active contribution rule can award. */
export function maxAchievableScore(policy: LeadScorePolicy): number {
  const total = policy.rules
    .filter(
      (rule) =>
        rule.availability === 'active' &&
        rule.kind === 'contribution' &&
        rule.points > 0,
    )
    .reduce((sum, rule) => sum + rule.points, 0);
  return Math.min(total, policy.maxScore);
}
