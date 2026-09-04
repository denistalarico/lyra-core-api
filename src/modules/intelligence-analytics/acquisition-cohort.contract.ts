import type {
  IntelligenceFreshness,
  IntelligenceProvenance,
} from '../../common/intelligence';
import type { CanonicalPaidMediaDestination } from '../social-integrations/sync/paid-media-destination';
import type {
  CanonicalAcquisitionChannel,
  ChannelResolution,
} from './acquisition-channel';

/**
 * What this view is, stated in the type system so it cannot be mistaken.
 *
 * The whole risk of putting ad spend next to won deals is that a reader — or a
 * future endpoint, or a UI author who never read this file — takes the
 * adjacency for causation and reports "this ad produced R$ 40.000". The numbers
 * here do not support that claim and never will at this join basis.
 *
 * So the claim the view *does* make is a required field of the payload rather
 * than a caveat in a comment. `kind` and `joinBasis` are single-member unions:
 * adding individual attribution later means adding a member and forcing every
 * consumer's switch to acknowledge it, instead of quietly changing what the
 * same-shaped response means.
 */
export type CohortAnalysisKind = 'cohort_correlation';

/**
 * How the two domains were lined up.
 *
 * `date_channel_bucket` — same tenant/workspace/client, same day bucket, same
 * channel bucket. That is a *coincidence in time and place*, which is genuinely
 * useful (it is how every media team reads a dashboard) and is not the same as
 * knowing which spend produced which conversation.
 */
export type CohortJoinBasis = 'date_channel_bucket';

/**
 * The paid-media side of the cohort.
 *
 * Every value is an exact-decimal string or null, exactly as it left the fact
 * source. Nothing here is a ratio: the derived block is computed once, from
 * these, at the end.
 *
 * `reach` is deliberately absent. It is `non_additive`, so it has no correct
 * value over a multi-day window, and a field that would be null on every
 * multi-day request is a field that teaches consumers to ignore nulls.
 */
export type CohortSocialFacts = {
  spend: string | null;
  impressions: string | null;
  clicks: string | null;
  linkClicks: string | null;
  /**
   * Leads **as the provider counted them**, never mixed with the LeadFlow
   * count. See `CohortDataQuality.providerLeadSemantics`.
   */
  providerLeads: string | null;
  conversions: string | null;
  conversionValue: string | null;
};

/**
 * The funnel side of the cohort, from LeadFlow and CRM.
 *
 * `qualifiedLeads` is now a real count, from the transition history I3.1
 * appends — the first observed qualification per conversation, counted once.
 * It is still `string | null`, and it is null when this scope has no history at
 * all: a `0` there would claim nobody qualified, when the truth is that nothing
 * was recorded. `dataQuality.qualificationHistory` carries the rest.
 */
export type CohortLeadFlowFacts = {
  conversationsReceived: string | null;
  inboundMessages: string | null;
  qualifiedLeads: string | null;
  opportunitiesCreated: string | null;
  wonOpportunities: string | null;
  /**
   * Named for what the CRM column holds, not for what a finance report would
   * call it.
   *
   * `crm_opportunities.value_amount` is the value a salesperson entered on the
   * opportunity. It is the agreed value of deals marked won — not invoiced,
   * not received, not recognised revenue. Calling it `revenue` would put a
   * number on a screen next to ad spend that a reader would reasonably take to
   * the accountant, and it would not match the books.
   */
  wonOpportunityValue: string | null;
};

/**
 * Cost and conversion ratios, derived at this level and never stored.
 *
 * All eight are quotients of the two blocks above, computed once from the
 * aggregated totals. Every one is `string | null`, and null means the
 * denominator was zero — never `0`, never `Infinity`, never `NaN`.
 *
 * The funnel rates are *not* multiplied into a percentage here; they are plain
 * quotients under a `ratio` reading, because the two sides are cohorts rather
 * than a tracked population and presenting `38%` invites the reader to treat it
 * as a conversion rate of specific people.
 */
export type CohortDerivedMetrics = {
  /** Spend ÷ provider-reported leads. The provider's own denominator. */
  providerCpl: string | null;
  costPerConversation: string | null;
  costPerQualifiedLead: string | null;
  costPerOpportunity: string | null;
  costPerWonOpportunity: string | null;
  conversationToQualifiedRate: string | null;
  qualifiedToOpportunityRate: string | null;
  opportunityToWonRate: string | null;
};

/**
 * What the reader must be told, carried as data.
 *
 * This block is the reason the view is safe to expose. Each flag answers a
 * question a reader would otherwise answer wrongly by assumption, and it
 * travels with the payload so a future UI cannot render the numbers without
 * also having received the caveats.
 */
/**
 * What the qualification count can and cannot speak for.
 *
 * Additive to the payload, and required reading before any rate derived from
 * `qualifiedLeads` is trusted. The count itself is always a real count of
 * observed first-qualifications; this block says how much of the window that
 * count could have seen.
 */
export type CohortQualificationHistory = {
  /**
   * Conversations whose first observed qualification fell in the window.
   *
   * Named `observed` rather than `qualified` deliberately: it is a count of
   * evidence, and for a window predating the history it is a floor.
   */
  observedQualified: string | null;
  /**
   * The earliest qualification transition on record for this scope, ISO, or
   * null when there is none.
   *
   * Derived from the data, not from a deploy date — so it stays true across
   * environments and across a restore from an older backup.
   */
  coverageStart: string | null;
  /**
   * True when the window opens before the evidence does.
   *
   * The flag that makes a pre-history window legible: conversations qualified
   * then are unclassifiable, not zero, and no rate computed over that window is
   * trustworthy.
   */
  legacyUnknown: boolean;
};

/**
 * What the destination evidence covers, and how precisely it can be read.
 *
 * Present even though this release produces a single `provider_bucket` cohort:
 * the coverage is what tells a reader whether destination-resolved reporting is
 * close or far away, and hiding it until the day it is used would mean nobody
 * could see it accumulating.
 */
export type CohortDestinationHistory = {
  /** How the destination was arrived at. `observed_destination` once resolvable. */
  destinationResolution: 'observed_destination' | 'unavailable';
  expectedDays: number;
  /** Days on which some ad set had an observation in force. */
  coveredDays: number;
  unknownDays: number;
  firstObservedAt: string | null;
  lastObservedAt: string | null;
  /**
   * The uncertainty floor, in hours.
   *
   * The hierarchy sweep is daily, so a destination change is located to within
   * a day at best. Carried as data so a UI cannot render an observation
   * timestamp as though its hour were meaningful.
   */
  observationCadenceHours: number;
};

export type CohortDataQuality = {
  /** Always true here. The numbers are correlated by period and channel. */
  cohortCorrelation: true;
  /**
   * Always false in I3. No number in this payload is derived from
   * `inbox_attribution_observations`, and none identifies which ad produced
   * which conversation.
   */
  individualAttribution: false;
  /** How the channel bucket was arrived at. */
  channelResolution: ChannelResolution;
  /** True when any covered day is still being written to by the sync. */
  partialData: boolean;
  /** Human-readable, ordered, and meant to be rendered verbatim. */
  limitations: string[];
  /** Coverage of the qualification evidence behind `leadflow.qualifiedLeads`. */
  qualificationHistory: CohortQualificationHistory;
  /** Coverage of the destination evidence behind the channel bucket. */
  destinationHistory: CohortDestinationHistory;
  /**
   * Metric keys the view asked for and could not obtain, with the reason.
   *
   * A named gap, so a consumer can distinguish "zero qualified leads" from
   * "this platform cannot yet count qualified leads" — which a bare `null`
   * cannot express.
   */
  missingFacts: Array<{ metricKey: string; reason: string }>;
};

/**
 * Where each side's numbers came from, kept separate.
 *
 * Not flattened into one `source: 'Lyra'`. The point of provenance is that
 * somebody can re-derive a figure they distrust, and that requires knowing that
 * spend came from `social_ad_metrics_daily` under `account_default` while the
 * funnel came from `crm_opportunities` written live.
 */
export type CohortProvenance = {
  social: IntelligenceProvenance;
  leadflow: IntelligenceProvenance;
  /** How this projector combined the two — the third fact of the derivation. */
  projector: {
    kind: CohortAnalysisKind;
    joinBasis: CohortJoinBasis;
    /** The timezone the day buckets were cut in, and where it came from. */
    dayBucketTimezone: string;
    dayBucketTimezoneSource: 'ad_account' | 'utc_fallback';
  };
};

/**
 * Combined freshness, with both sides kept legible.
 *
 * `overallPartial` is the OR of the two, because a view is only as current as
 * its least current half: a reader told "as of now" while D0 spend is still
 * landing would compute a cost per lead that changes under them tomorrow.
 */
export type CohortFreshness = {
  social: IntelligenceFreshness;
  leadflow: IntelligenceFreshness;
  overallPartial: boolean;
};

/**
 * Why a destination bucket's LeadFlow side is absent.
 *
 * Three genuinely different reasons, kept apart because a UI must render them
 * differently. `null` on its own cannot distinguish "nobody wrote in" from "this
 * comparison does not exist", and a reader shown an empty cell assumes the first.
 */
export type CohortBucketLeadFlowSupport =
  /** The destination names one Inbox channel and its counts are real. */
  | 'mapped'
  /**
   * The ad set offered several inboxes and Meta reports the offer, not the
   * choice. Summing WhatsApp, Instagram and Messenger to match it would invent
   * per-person routing nobody measured.
   */
  | 'multi_destination'
  /**
   * The destination does not land in an Inbox at all — a website, a lead form,
   * an app, a phone call, a profile visit, an on-post interaction. There is no
   * LeadFlow population to count, rather than an empty one.
   */
  | 'no_inbox_equivalent'
  /** The destination itself is unknown, so no channel can be named. */
  | 'destination_unknown';

/**
 * One destination's paid-media side.
 *
 * Every field is additive over ad sets and days, which is what makes summing
 * them legitimate. `reach` is absent by the same rule that keeps it out of
 * `CohortSocialFacts`: Meta de-duplicates it per object per day, and no
 * arithmetic recovers a period reach per destination from daily per-ad-set
 * figures. A field that would be null on every request is a field that teaches
 * consumers to ignore nulls.
 */
export type CohortDestinationSocialFacts = {
  spend: string | null;
  impressions: string | null;
  clicks: string | null;
  linkClicks: string | null;
  /** Leads **as Meta counted them**, never mixed with a LeadFlow count. */
  providerLeads: string | null;
  conversions: string | null;
  conversionValue: string | null;
  videoViews: string | null;
};

/**
 * One destination's funnel side, or the reason there is none.
 *
 * All three counts are null unless `support` is `mapped`. That is not a data
 * gap: for `messaging_multi` and the non-inbox destinations there is no
 * conversation population that corresponds to the spend, and a `0` would assert
 * that nobody arrived when the truth is that arrival is not observable at this
 * grain.
 */
export type CohortDestinationLeadFlowFacts = {
  support: CohortBucketLeadFlowSupport;
  /** The Inbox channel these counts came from, when one was named. */
  channel: CanonicalAcquisitionChannel | null;
  conversationsReceived: string | null;
  inboundMessages: string | null;
  qualifiedLeads: string | null;
};

/**
 * The costs a destination bucket can support.
 *
 * Three, not eight. `costPerOpportunity` and `costPerWonOpportunity` are absent
 * from this level entirely rather than present-and-null, because the CRM holds
 * no destination breakdown and never will at this join basis — offering the
 * fields would invite a future author to fill them by correlating same-day,
 * same-channel opportunities with spend, which is attribution by another name.
 *
 * The stage-to-stage rates are absent for the reason stated in
 * `COHORT_EVENT_WINDOW_LIMITATION`, unchanged by the existence of buckets.
 */
export type CohortDestinationDerived = {
  /** Spend ÷ provider-reported leads, from this destination's own ad sets. */
  providerCpl: string | null;
  /** Null unless the destination maps to a channel. */
  costPerConversation: string | null;
  /** Null unless the destination maps to a channel. */
  costPerQualifiedLead: string | null;
};

/** What is and is not knowable about one bucket. */
export type CohortDestinationDataQuality = {
  /**
   * How this bucket's destination was arrived at.
   *
   * `observed_destination` for every bucket built from an observation; the
   * `unknown` bucket carries `unavailable`, because no observation named it.
   */
  resolution: 'observed_destination' | 'unavailable';
  /** Always false. No number in a bucket identifies an individual. */
  individualAttribution: false;
  /** Whether a LeadFlow comparison exists, and why not when it does not. */
  leadflowSupport: CohortBucketLeadFlowSupport;
  /** True when any day contributing to this bucket was still being written. */
  partialData: boolean;
  /** Days in the window this bucket holds ad-set facts for. */
  factDays: number;
  /**
   * Spend in this bucket that predates its ad sets' first observation.
   *
   * Only ever non-null on `unknown`, and it is what splits that bucket's two
   * populations: money from days no observation can speak for (which the sync
   * will resolve as it catches up) against money whose observed provider string
   * this pipeline does not map (which needs a mapping entry). Reported as data
   * rather than two buckets, so the canonical destination set stays closed.
   */
  temporalUnknownSpend: string | null;
  /** Bucket-specific caveats, additional to the response-level ones. */
  limitations: string[];
};

/**
 * One paid-media destination, with both sides of it.
 *
 * Purely additive to the response: `AcquisitionCohortView` keeps every field it
 * had, computed the way it was, and this array sits beside them. A consumer
 * written against I3.3 continues to work and simply does not read it.
 */
export type CohortDestinationBucket = {
  destination: CanonicalPaidMediaDestination;
  social: CohortDestinationSocialFacts;
  leadflow: CohortDestinationLeadFlowFacts;
  derived: CohortDestinationDerived;
  dataQuality: CohortDestinationDataQuality;
  provenance: CohortDestinationProvenance;
};

/**
 * Where one bucket's numbers came from, per layer.
 *
 * Not flattened, and not inherited from the response-level provenance, because
 * a bucket's three layers have genuinely different sources: the money is a
 * synced fact at a level the response-level provenance does not name, the
 * destination is observational evidence, and the conversation counts are live
 * rows. Somebody re-deriving a figure they distrust needs all three.
 */
export type CohortDestinationProvenance = {
  /** `social_ad_metrics_daily` at ad-set level. */
  socialMetrics: string;
  /** `social_ad_destination_observations`. */
  destination: string;
  /** The Inbox source, or null when no channel was mapped. */
  leadflow: string | null;
};

/**
 * The destination breakdown, with the coverage needed to read it.
 *
 * A block rather than a bare array, because an empty array has two meanings and
 * the difference decides whether a UI shows "no spend" or "still ingesting".
 */
export type CohortDestinationBreakdown = {
  /**
   * Whether ad-set facts exist for this window at all.
   *
   * False while I3.4's ad-set backfill has not reached this window, which is a
   * real and expected state for a connection whose account-level chain was
   * certified before ad set existed. The response is still complete —
   * `totals` are unaffected — and this flag is what stops a reader taking an
   * empty breakdown for a period of no delivery.
   */
  available: boolean;
  /** Days of the window that carry an ad-set fact. */
  coveredDays: number;
  expectedDays: number;
  buckets: CohortDestinationBucket[];
};

/** One cohort row: a period, a channel bucket, and the two sides of it. */
export type AcquisitionCohortView = {
  kind: CohortAnalysisKind;
  joinBasis: CohortJoinBasis;
  period: { since: string; until: string };
  channel: CanonicalAcquisitionChannel;
  currency: string | null;
  /**
   * Informative only, and null unless LeadFlow resolved one. I3 never requires
   * it and never filters on it — Business Mode is I5.
   */
  businessMode: string | null;
  social: CohortSocialFacts;
  leadflow: CohortLeadFlowFacts;
  derived: CohortDerivedMetrics;
  /**
   * Paid media split by where it sent people, added in I3.5.
   *
   * Additive to everything above it. `totals`, `social`, `leadflow` and `derived`
   * are still computed exactly as I3.3 computed them — from account-level facts
   * and window-level counts — and are *not* rebuilt by summing these buckets.
   * That is deliberate: the account row includes delivery belonging to no ad set
   * the hierarchy has mirrored, the `unknown` bucket would fold into the total
   * silently, and reach could not survive the trip. A breakdown that does not
   * reconstruct its own parent is the honest shape here.
   */
  destinations: CohortDestinationBreakdown;
  provenance: CohortProvenance;
  freshness: CohortFreshness;
  dataQuality: CohortDataQuality;
};

/**
 * The limitation that must appear on every response.
 *
 * Written once, exported, and asserted by a spec — because the failure mode of
 * a caveat is that a later edit drops it and nothing breaks.
 */
export const COHORT_CORRELATION_LIMITATION =
  'Os dados de mídia e funil foram comparados por período e canal. ' +
  'Esta vista não representa atribuição individual de leads.';

/**
 * Why the two funnel rates stay null.
 *
 * The semantics this view has always used is an **event window**: each metric
 * counts the events that occurred inside the period, cohorted on its own date —
 * conversations on `created_at`, qualifications on the transition instant, won
 * deals on `won_at`. That is what makes each number individually correct, and it
 * is exactly what makes a ratio between two of them wrong: a conversation
 * received on 31/08 and qualified on 02/09 is in August's numerator of nothing
 * and September's numerator of qualifications, so
 * `qualified ÷ conversations` divides two populations that only partly overlap.
 *
 * The number would look like a conversion rate, sit next to real ones, and be
 * off by however much the funnel lags the window — which is largest for short
 * windows, where readers look hardest. An entry-cohort funnel (follow the
 * conversations that *entered* the window wherever they later go) would answer
 * it correctly and is a different view with a different shape; it is not
 * something to approximate here.
 */
export const COHORT_EVENT_WINDOW_LIMITATION =
  'As métricas são contadas por evento ocorrido no período: conversas pela ' +
  'data de abertura, qualificações pela data da transição e negócios pela ' +
  'data de fechamento. Por isso as taxas de conversão entre etapas não são ' +
  'calculadas — uma conversa aberta no fim do período pode qualificar no ' +
  'período seguinte, e a razão entre as duas contagens compararia grupos ' +
  'diferentes.';

/** Stated whenever the window opens before qualification history does. */
export const COHORT_QUALIFICATION_LEGACY_LIMITATION =
  'O histórico de qualificação começa em uma data posterior ao início do ' +
  'período solicitado. Conversas qualificadas antes dessa data não possuem ' +
  'registro de transição e não podem ser contadas: o número apresentado é um ' +
  'piso, não o total.';

/**
 * Stated only while ad-set facts are missing for the requested window.
 *
 * It was on every response through I3.3, when media metrics genuinely stopped at
 * campaign level. I3.4 ingests ad-set insights, so the sentence is now true of a
 * *window* rather than of the platform: a connection certified before ad set
 * existed still has old windows with no ad-set rows, and for those the
 * breakdown cannot be produced for exactly this reason. Once the backfill
 * reaches a window, the limitation stops being emitted for it.
 */
export const COHORT_DESTINATION_GRAIN_LIMITATION =
  'O destino da campanha (WhatsApp, Instagram Direct ou Messenger) é ' +
  'registrado por conjunto de anúncios, mas as métricas de mídia são ' +
  'coletadas apenas nos níveis de conta e campanha. Como uma campanha pode ' +
  'conter conjuntos com destinos diferentes, o investimento não pode ser ' +
  'separado por destino sem rateio estimado — que não é feito.';

/** Stated whenever destination evidence exists but does not cover the window. */
export const COHORT_DESTINATION_OBSERVATION_LIMITATION =
  'O destino é conhecido por observação: a sincronização diária registra o ' +
  'que o provedor respondeu naquele momento. Uma mudança detectada em uma ' +
  'data ocorreu em algum ponto desde a observação anterior, não naquela data.';

/** Stated on every response: multi-destination ad sets name no single inbox. */
export const COHORT_MESSAGING_MULTI_LIMITATION =
  'Conjuntos de anúncios com destino múltiplo (messaging_multi) oferecem ' +
  'mais de uma caixa de entrada e o provedor não informa qual delas cada ' +
  'pessoa escolheu. Esse volume não é distribuído entre WhatsApp, Instagram ' +
  'e Messenger.';

/**
 * Carried on every destination bucket that has a LeadFlow side.
 *
 * The bucket is where this warning belongs rather than only the response, and the
 * reason is the shape a UI will render: a card showing "R$ 1.240 · 38 conversas ·
 * R$ 32,63 por conversa" reads as a per-ad result unless the caveat is attached
 * to that card. A response-level footnote is one scroll away from the number it
 * qualifies.
 */
export const COHORT_BUCKET_CORRELATION_LIMITATION =
  'O investimento deste destino e as conversas deste canal foram comparados ' +
  'por período. Não representa atribuição individual entre anúncio e conversa.';

/** Carried on the `messaging_multi` bucket, which has no funnel side. */
export const COHORT_BUCKET_MESSAGING_MULTI_LIMITATION =
  'O conjunto de anúncios permitia múltiplos destinos; o destino final de ' +
  'cada conversa não é identificável por dados agregados.';

/** Carried on every bucket that does not land in an Inbox. */
export const COHORT_BUCKET_NO_INBOX_LIMITATION =
  'Este destino não termina em uma caixa de entrada do LeadFlow, portanto ' +
  'não há conversas correspondentes para comparar — a ausência não significa ' +
  'volume zero.';

/** Carried on the `unknown` bucket. */
export const COHORT_BUCKET_UNKNOWN_LIMITATION =
  'O destino destes conjuntos de anúncios não é conhecido: ou o período é ' +
  'anterior à primeira observação, ou o provedor informou um destino que ' +
  'ainda não é reconhecido. O investimento é real e não foi redistribuído ' +
  'entre os demais destinos.';

/** Stated when the window has no ad-set facts at all. */
export const COHORT_DESTINATION_UNINGESTED_LIMITATION =
  'As métricas por conjunto de anúncios ainda não foram coletadas para este ' +
  'período, portanto a separação por destino não está disponível. Os totais ' +
  'do período não são afetados.';

/** Stated when only part of the window has ad-set facts. */
export const COHORT_DESTINATION_PARTIAL_INGEST_LIMITATION =
  'A separação por destino cobre apenas parte do período: os dias sem ' +
  'métricas por conjunto de anúncios não aparecem em nenhum destino, e a ' +
  'soma dos destinos é menor que o total do período.';

/**
 * Stated on every response that carries a breakdown.
 *
 * The property a reader will otherwise assume and be wrong about. The buckets do
 * not add up to `social.spend`: the account-level total includes delivery
 * belonging to no mirrored ad set, and days without ad-set facts contribute to
 * the total and to no bucket. Presenting a breakdown that silently fails to
 * reconcile is worse than presenting none.
 */
export const COHORT_DESTINATION_NOT_A_PARTITION_LIMITATION =
  'A soma dos destinos pode ser menor que o total do período: o total é ' +
  'medido no nível da conta e inclui entregas sem conjunto de anúncios ' +
  'espelhado, além de dias ainda não coletados nesse nível.';
