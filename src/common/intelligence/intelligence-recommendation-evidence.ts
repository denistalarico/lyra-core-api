import type {
  IntelligenceCoverage,
  IntelligenceProvenance,
} from './intelligence-fact';
import type { IntelligenceAdditivity } from './intelligence-metric';

/**
 * What kind of claim one piece of evidence is making.
 *
 * This is the field the whole contract exists for, and the reason it is
 * mandatory. The Intelligence Foundation spent I3 and I4 establishing that a
 * cohort correlation and an observed attribution are *different claims about
 * different things* — one says "spend and won deals moved together in this
 * window", the other says "this specific conversation carried this specific ad
 * id". A recommendation that presented the first as though it were the second
 * would undo that distinction at the last step, in the one place a human is
 * about to act on it.
 *
 * `recommendation` is deliberately not a member. Evidence is what a
 * recommendation is built *from*; a recommendation citing another recommendation
 * as evidence is a conclusion citing itself.
 */
export type IntelligenceEvidenceSemanticKind =
  /**
   * A measurement of something that happened, read from a canonical store.
   *
   * The strongest and least interesting kind: "this automation failed 4 of 10
   * live runs". No inference, no cross-domain join, no third-party attribution
   * model — just a count of rows the platform itself wrote.
   */
  | 'factual_observation'
  /**
   * Two quantities moved together over a window, measured in aggregate.
   *
   * The I3 claim. It supports "these are related"; it does **not** support
   * "this caused that", and it does not resolve to any individual subject.
   * Evidence carrying this kind must never be rendered as though a specific
   * conversion came from a specific ad.
   */
  | 'cohort_correlation'
  /**
   * An individual link the provider itself reported.
   *
   * The I4 claim: a conversation that arrived carrying an ad identifier, matched
   * to an ad this workspace runs. Stronger than correlation because it is
   * per-subject — and still narrower than "attribution" in the marketing sense,
   * because it observes only what the provider disclosed and says nothing about
   * what would have happened otherwise.
   */
  | 'observed_attribution'
  /**
   * This workspace's value set against an anonymous cohort of others.
   *
   * The I6 claim, and the only kind whose availability depends on consent and
   * k-anonymity. Evidence of this kind is an *enrichment*: an operational
   * recommendation must remain producible when no benchmark is available.
   */
  | 'benchmark_comparison';

/**
 * A limitation, as a code rather than a sentence.
 *
 * Free text was the obvious modelling and is the wrong one. A limitation exists
 * to change what a consumer is allowed to *do* — refuse to sum a value, refuse
 * to convert a currency, refuse to call a number revenue — and a consumer cannot
 * branch on prose. Worse, prose is written in one language: the platform's
 * narrative strings are pt-BR, so a limitation carried only as a label would be
 * unreadable to any future consumer that is not the current UI.
 *
 * So the code is the machine-readable claim and `detail` is the optional human
 * gloss beside it, never instead of it.
 *
 * The union is open at the edges on purpose — `IntelligenceEvidenceLimitationCode`
 * enumerates the cases the Foundation has actually established, and each one
 * corresponds to a real, documented hazard rather than a hypothetical.
 */
export type IntelligenceEvidenceLimitationCode =
  /**
   * The metric may not be added across rows. Reach is the canonical case: Meta
   * de-duplicates people within a day, so two days share an unknown number of
   * the same people and the sum exceeds the truth by an unmeasurable amount.
   */
  | 'non_additive_metric'
  /**
   * Amounts in more than one currency were observed and were not converted.
   * There is no FX layer, so a total across them would be a number with no unit.
   */
  | 'no_fx_normalization'
  /**
   * A pipeline value is not booked revenue. `wonOpportunityValue` is what the
   * commercial domain recorded on an opportunity, not what finance invoiced.
   */
  | 'value_is_not_revenue'
  /**
   * The window opens before this signal began being recorded, so the absence of
   * evidence in its early part is not evidence of absence.
   */
  | 'unavailable_before_first_observation'
  /**
   * The provider did not disclose the destination. Distinct from the case above:
   * here the observation exists and the field is genuinely unknown.
   */
  | 'destination_unknown'
  /**
   * A provider value covers several possibilities and must not be narrowed to
   * one. Meta's `messaging_multi` spans more than WhatsApp, and inferring
   * WhatsApp from it would invent a precision the API never offered.
   */
  | 'ambiguous_provider_value'
  /**
   * The source could not speak for the whole requested window — a sync still in
   * progress, or a day still being written to.
   */
  | 'partial_source_coverage'
  /**
   * An anonymous cohort existed but was smaller than the k-anonymity floor, so
   * no comparison is reportable. Fails closed, and says so rather than omitting
   * the evidence silently.
   */
  | 'benchmark_below_k_threshold';

export type IntelligenceEvidenceLimitation = {
  code: IntelligenceEvidenceLimitationCode;
  /** Optional human gloss. Never the sole carrier of the limitation. */
  detail?: string;
  /** The metric the limitation binds to, when it binds to one and not the item. */
  metricKey?: string;
};

/**
 * The period one piece of evidence speaks for.
 *
 * Separate from the recommendation's own period, and that separation is the
 * point: a comparative claim has a baseline window and an observed window, and
 * a single period on the parent cannot express both. Carried as instants rather
 * than `IntelligenceWindow`'s calendar days because the recommendation domain's
 * own periods are `timestamptz` — widening them to days here would lose the
 * boundary the evidence was actually measured at.
 */
export type IntelligenceEvidenceWindow = {
  /** Inclusive ISO 8601 instant the measurement opens at. */
  from: string;
  /** Exclusive-or-inclusive per the owning domain; ISO 8601 instant. */
  to: string;
};

/**
 * The current version of the evidence shape.
 *
 * Every persisted item carries it, so a reader confronted with a JSONB row
 * written months ago can decide how to interpret it without inferring the shape
 * from which fields happen to be present. That inference is exactly what breaks
 * when a future version makes an optional field required or changes a code's
 * meaning: the fields present look the same and the meaning has moved.
 */
export const INTELLIGENCE_RECOMMENDATION_EVIDENCE_SCHEMA_VERSION = 1;

/**
 * One piece of evidence behind a recommendation, with enough structure that a
 * consumer can explain it without having been told what it means.
 *
 * ## Why this is not an `IntelligenceFact`
 *
 * A fact belongs to the domain that measured it and is re-read on every request;
 * evidence is a *snapshot*, frozen at generation, that has to stay interpretable
 * after the underlying rows change or disappear. Embedding a whole
 * `IntelligenceFactSet` in every recommendation would copy descriptors, grain,
 * subject and a full fact list into a row that needs one number — and would tie
 * the persisted shape to a contract that is free to evolve because nothing
 * persists it. So this borrows the *vocabulary* (`IntelligenceProvenance`,
 * additivity, unit, coverage) and stays its own, smaller thing.
 *
 * ## Backward compatibility
 *
 * `ref`, `label`, `metric`, `value` and `unit` are the five fields the previous
 * shape had, kept at the same names and the same types. The contract is a strict
 * superset: an existing consumer reading `evidence.label` keeps working, and a
 * row written before this version is still structurally valid — it simply lacks
 * `schemaVersion`, which is how a reader recognises it.
 */
export type IntelligenceRecommendationEvidenceV1 = {
  /**
   * Which version of this shape the row was written under.
   *
   * Literal-typed rather than `number` so a future V2 is a new member of a union
   * and every `switch` over it fails to compile until it handles both — the
   * whole reason for versioning a persisted shape.
   */
  schemaVersion: typeof INTELLIGENCE_RECOMMENDATION_EVIDENCE_SCHEMA_VERSION;

  /**
   * Stable pointer to where the number came from, `source:subject:metric`.
   *
   * Also the item's identity within a recommendation: the UI keys on it, so it
   * must be unique in the array and stable across regenerations of the same
   * recommendation.
   */
  ref: string;

  /**
   * Human presentation text, in the platform's narrative language.
   *
   * Kept, and kept explicitly *beside* the structure rather than as a carrier of
   * it. A future consumer must be able to render this evidence from
   * `metricKey` + `value` + `unit` + `semanticKind` + `limitations` alone, in a
   * language this string is not written in.
   */
  label: string;

  /**
   * The metric key, at its original field name for compatibility.
   *
   * `snake_case` is the Foundation's convention for metric keys
   * (`IntelligenceMetricDescriptor.key`); this domain's existing values are
   * `camelCase` (`failureRate`) and are **not** renamed here, because renaming
   * them would change the persisted content of a shipped API for a cosmetic
   * gain. Convergence belongs to whichever slice introduces a second producer.
   */
  metric: string;

  /** The observed value, at its original type. */
  value: number | string;

  /**
   * The unit, at its original field name and type.
   *
   * Deliberately `string` rather than `IntelligenceMetricUnit`, and the reason
   * is worth stating because the narrower type looks strictly better. The
   * Foundation's union is closed over the units *paid media and conversation*
   * report; the existing producer emits `'runs'`, which is not a member and is
   * not wrong — it is a unit this domain genuinely measures in. Narrowing the
   * field would force either a behaviour change to satisfy a type or a
   * `'count'` that says less than `'runs'` does.
   *
   * `IntelligenceMetricUnit | string` was the first attempt and is worse than
   * either: TypeScript collapses it to `string`, so it enforces nothing while
   * appearing to. Producers that *do* report in Foundation units should spell
   * one of those values here; `IntelligenceMetricUnit` is re-exported beside
   * this type for exactly that.
   */
  unit: string;

  /**
   * What kind of claim this is. Mandatory, and mandatory on purpose: an evidence
   * item whose semantic kind was optional would default to being read as
   * whatever the consumer assumed, which is the failure the field prevents.
   */
  semanticKind: IntelligenceEvidenceSemanticKind;

  /** How the value may be combined, where the producer can state it. */
  additivity?: IntelligenceAdditivity;

  /** How it was computed, when that is not simply "the stored column". */
  formula?: string;

  /** The period this item speaks for, where it differs from a point reading. */
  window?: IntelligenceEvidenceWindow;

  /**
   * How this was known. Reuses the Foundation's contract rather than declaring a
   * second provenance interface — two provenance shapes would eventually
   * disagree about what `canonicalSource` means.
   */
  provenance: IntelligenceProvenance;

  /**
   * How much of the window the source could speak for, where the producer reads
   * a source that can be partial. Absent for a canonical live read of a complete
   * period, which is the honest answer rather than a fabricated `100%`.
   */
  coverage?: IntelligenceCoverage;

  /**
   * What this evidence cannot be used for. Always an array — an empty one is a
   * positive claim that the producer considered the question, and is different
   * from an absent field.
   */
  limitations: IntelligenceEvidenceLimitation[];
};

/**
 * Whether a persisted row was written under the current shape.
 *
 * The reason this exists rather than a cast: a JSONB column returns whatever was
 * stored, including rows written before the field existed, and TypeScript's
 * declared type is a claim about new writes only. A consumer that must branch on
 * version asks here.
 */
export function isCurrentRecommendationEvidence(
  value: unknown,
): value is IntelligenceRecommendationEvidenceV1 {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { schemaVersion?: unknown }).schemaVersion ===
      INTELLIGENCE_RECOMMENDATION_EVIDENCE_SCHEMA_VERSION
  );
}
