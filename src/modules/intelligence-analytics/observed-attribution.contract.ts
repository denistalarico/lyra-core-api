/**
 * The shape of one conversation's observed attribution.
 *
 * `kind` is the first field for the same reason `cohort_correlation` is on the
 * I3 view: a consumer must be able to tell what class of claim it is holding
 * before it reads a single number. This one says `observed_attribution` — the
 * provider reported an identifier on an inbound message, and that identifier
 * resolves to an ad we mirror. It does not say the ad caused the sale.
 */
export type ObservedAttributionKind = 'observed_attribution';

/**
 * Why the bridge did or did not reach an ad.
 *
 * Six states, each with a different cause and a different remedy. The brief
 * asked for at least six and for any impossible ones to be documented rather
 * than invented; all six are reachable here:
 *
 * - `matched` — an observed ad id resolved to exactly one ad in scope.
 * - `no_ad_id` — the conversation has no observation carrying an ad id. Either
 *   no referral was ever reported, or the only ones reported carried just a
 *   click id (an organic-surface referral).
 * - `ad_not_found` — the id is real but this workspace's mirror has no such ad.
 *   Hierarchy not synced, or an ad account this agency does not manage.
 * - `ambiguous_connection` — the id resolves under more than one connection in
 *   the same scope, so the evidence cannot decide. Fail closed.
 * - `unsupported_provider` — evidence exists but from a provider whose referral
 *   this layer does not resolve. Today only Meta produces ad ids at all.
 * - `conflicting_observations` — several observations name different ads. Every
 *   click is real; choosing one would be a modelling decision, and I4 makes
 *   none.
 *
 * `scope_mismatch` from the brief is deliberately **absent**, and this is the
 * documented simplification. A conversation outside the caller's scope is not
 * reported as mismatched — the endpoint 404s, because confirming that an id
 * exists but belongs to someone else is exactly the signal cross-tenant
 * enumeration needs. Within a resolvable scope, an ad that fails the scope
 * predicate is indistinguishable from one that does not exist, and
 * `ad_not_found` states that truthfully without leaking the difference.
 */
export type ObservedAttributionMatchStatus =
  | 'matched'
  | 'no_ad_id'
  | 'ad_not_found'
  | 'ambiguous_connection'
  | 'unsupported_provider'
  | 'conflicting_observations';

/** One provider observation, as evidence. */
export type ObservedAttributionEvidence = {
  observationId: string;
  messageId: string;
  provider: string;
  channelType: string;
  adId: string | null;
  /**
   * Whether a click id was observed — never the click id itself.
   *
   * The value is a provider-side identifier tied to one person's click. It is
   * stored (I1.1 keeps it because it cannot be reconstructed later), but a
   * reporting endpoint does not need to hand it out to state that evidence
   * exists, and echoing it would put a per-click identifier into every consumer
   * that renders this view.
   */
  clickIdPresent: boolean;
  sourceType: string | null;
  observedAt: string;
};

/**
 * How the destination evidence relates across a conversation's observations.
 *
 * A separate vocabulary from the attribution `consistency`, and the separation
 * is the point of I4.1 §5: two observations of the *same* ad are not an
 * attribution conflict, but the ad set's destination may still have been
 * observed differently between them. Reusing one word for both would make
 * "consistent attribution, varying destination" unsayable.
 *
 * - `single` — one evidence instant resolved.
 * - `multiple_consistent` — several instants, all resolving to the same
 *   destination.
 * - `temporal_variation` — several instants resolving to different
 *   destinations. The ad did not change; what it pointed at did, and both
 *   readings are true of their own moment.
 * - `unavailable` — nothing resolved, for any instant.
 */
export type ObservedAttributionDestinationConsistency =
  | 'single'
  | 'multiple_consistent'
  | 'temporal_variation'
  | 'unavailable';

/**
 * The ad set's destination as of one piece of evidence.
 *
 * `observedAt` is when the destination was *seen*, never when it changed —
 * Meta does not report the latter, and the whole observations table exists
 * because of that. `raw` is what separates the two causes of `unknown`.
 */
export type ObservedAttributionDestinationReading = {
  /** The observation this reading belongs to, so it is never free-floating. */
  observationId: string;
  /** The attribution instant that was resolved. */
  attributionObservedAt: string;
  value: string;
  resolution: 'observed_destination' | 'unavailable_before_first_observation';
  destinationObservedAt: string | null;
  raw: string | null;
};

/**
 * The destination evidence attached to a matched attribution.
 *
 * `value` is stated only when every reading agrees — under
 * `temporal_variation` it is null, because there is no single destination that
 * was true for the whole conversation and picking one would be the collapse
 * §5 forbids. `readings` always carries the per-observation detail, so nothing
 * is lost either way.
 */
export type ObservedAttributionDestination = {
  value: string | null;
  resolution:
    | 'observed_destination'
    | 'unavailable_before_first_observation'
    | 'temporal_variation';
  observedAt: string | null;
  raw: string | null;
  consistency: ObservedAttributionDestinationConsistency;
  readings: ObservedAttributionDestinationReading[];
};

/** Where a matched ad sits, provider ids only. */
export type ObservedAttributionPaidMedia = {
  connectionId: string;
  accountId: string | null;
  campaignId: string | null;
  adsetId: string | null;
  adId: string;
  adName: string | null;
  adsetName: string | null;
  campaignName: string | null;
  /**
   * I4.1's addition. Null when the ad set itself did not resolve — there is
   * nothing to carry evidence about.
   */
  destination: ObservedAttributionDestination | null;
};

/** One explicitly linked opportunity. */
export type ObservedAttributionOpportunity = {
  opportunityId: string;
  status: string;
  isWon: boolean;
  wonAt: string | null;
  /**
   * The seller-entered deal value.
   *
   * Named `opportunityValue`, never `revenue`. Nothing here has been invoiced,
   * collected or reconciled with Finance; it is a number a salesperson typed
   * into a CRM field.
   */
  opportunityValue: string | null;
  currency: string | null;
};

/**
 * The commercial outcomes of one attributed conversation.
 *
 * A collection plus counts, never a single "the" opportunity. A conversation
 * can produce zero, one or several, and there is no evidence that would let
 * this layer pick one.
 */
export type ObservedAttributionOutcomes = {
  opportunities: ObservedAttributionOpportunity[];
  opportunityCount: number;
  wonOpportunityCount: number;
  /**
   * Summed value of won opportunities, or null when the linked deals are in
   * more than one currency.
   *
   * The same refusal the LeadFlow fact adapter makes: adding unlike units is
   * worse than declining to add them, because the sum looks authoritative.
   */
  wonOpportunityValue: string | null;
  currency: string | null;
};

export type ObservedAttributionDataQuality = {
  /**
   * True only when a provider-observed identifier resolved to exactly one ad.
   *
   * This is the field the whole feature exists to be able to set truthfully. It
   * means an individual, observed link exists between one inbound message and
   * one ad — a fact, not a model. It does **not** mean the ad caused the
   * conversation, the qualification or the sale, and
   * `OBSERVED_ATTRIBUTION_CAUSALITY_LIMITATION` says so in the response.
   */
  individualAttribution: boolean;
  /** Whether the provider reported any identifier at all. */
  providerEvidence: boolean;
  /** Whether the ad resolved into the mirrored hierarchy. */
  hierarchyResolved: boolean;
  /** Whether any opportunity was reached by an explicit conversation link. */
  opportunityLinkExplicit: boolean;
  /** Whether observations name more than one ad. */
  attributionConflict: boolean;
  /**
   * Whether a destination was resolved for every evidence instant.
   *
   * I4.1. Deliberately *not* folded into `hierarchyResolved`: an ad can resolve
   * perfectly while its destination history begins after the conversation did,
   * and conflating the two would make a matched attribution look broken.
   */
  destinationResolved: boolean;
  /** Whether any destination observation preceded the attribution at all. */
  destinationTemporalEvidence: boolean;
  destinationConsistency: ObservedAttributionDestinationConsistency;
  limitations: string[];
};

export type ObservedAttributionProvenance = {
  observation: string;
  conversation: string;
  paidMedia: string;
  /**
   * I4.1. Its own layer, not flattened into `paidMedia`: the hierarchy comes
   * from the mirror of current objects and the destination from an append-only
   * evidence log, and they carry different guarantees. A reader deciding how
   * much to trust a destination must be able to see which table it came from.
   */
  destination: string;
  qualification: string;
  opportunity: string;
  projector: string;
};

export type ObservedAttributionView = {
  kind: ObservedAttributionKind;
  conversation: {
    conversationId: string;
    firstObservedAt: string | null;
    lastObservedAt: string | null;
    observationCount: number;
    distinctAdIds: string[];
    consistency: 'none' | 'single' | 'multiple_consistent' | 'conflicting';
    firstQualifiedAt: string | null;
  };
  evidence: ObservedAttributionEvidence[];
  /** Null unless `matchStatus` is `matched`. */
  paidMedia: ObservedAttributionPaidMedia | null;
  outcomes: ObservedAttributionOutcomes;
  matchStatus: ObservedAttributionMatchStatus;
  /** Populated only for `ambiguous_connection`, so an operator can act. */
  ambiguousConnectionIds: string[];
  provenance: ObservedAttributionProvenance;
  dataQuality: ObservedAttributionDataQuality;
};

/**
 * The limitation that must travel with every matched result.
 *
 * `individualAttribution: true` is a strong-looking flag, and the failure mode
 * is a consumer reading it as proof of causation. The observation proves the
 * click happened and that this thread began after it. It does not establish
 * that the ad produced the sale, that the sale would not have happened
 * otherwise, or that no other touchpoint contributed.
 */
export const OBSERVED_ATTRIBUTION_CAUSALITY_LIMITATION =
  'Vínculo observado, não causal: o provedor reportou que esta conversa começou ' +
  'após um clique neste anúncio. Isso não prova que o anúncio causou a ' +
  'qualificação ou a venda, nem exclui outros pontos de contato.';

export const OBSERVED_ATTRIBUTION_CONFLICT_LIMITATION =
  'A conversa carrega observações de anúncios diferentes. Os cliques são todos ' +
  'reais; escolher um exigiria um modelo de atribuição (primeiro toque, último ' +
  'toque), que esta camada não aplica.';

export const OBSERVED_ATTRIBUTION_NOT_FOUND_LIMITATION =
  'O anúncio observado não existe no espelho desta conta. Ou a hierarquia ainda ' +
  'não foi sincronizada, ou o anúncio pertence a uma conta de anúncios que esta ' +
  'agência não gerencia.';

export const OBSERVED_ATTRIBUTION_AMBIGUOUS_LIMITATION =
  'O mesmo id de anúncio existe em mais de uma conexão deste contexto. IDs da ' +
  'Meta são únicos por Business, não entre Businesses, então a evidência não ' +
  'decide qual conexão vale.';

export const OBSERVED_ATTRIBUTION_PROVIDER_LIMITATION =
  'Somente o WhatsApp da Meta reporta o anúncio de origem no inbound hoje. ' +
  'Instagram Direct e Messenger não enviam referral equivalente, então conversas ' +
  'desses canais não têm evidência para atribuir — o que não significa que não ' +
  'vieram de anúncio.';

export const OBSERVED_ATTRIBUTION_CLICK_ID_LIMITATION =
  'Foi observado um click id sem id de anúncio. Resolver um click id exigiria ' +
  'consultar a API do provedor, o que esta camada não faz — a evidência fica ' +
  'registrada, mas não atribui.';

export const OBSERVED_ATTRIBUTION_NO_BACKFILL_LIMITATION =
  'A observação só existe para mensagens recebidas depois que a captura foi ' +
  'implantada. A Meta não expõe o referral de mensagens passadas, então conversas ' +
  'anteriores são permanentemente não atribuíveis.';

export const OBSERVED_ATTRIBUTION_VALUE_LIMITATION =
  'wonOpportunityValue é o valor digitado pelo vendedor na oportunidade, não ' +
  'receita faturada ou reconciliada com o Financeiro.';

export const OBSERVED_ATTRIBUTION_DESTINATION_HISTORY_LIMITATION =
  'O histórico de destino deste conjunto começa depois desta conversa. O destino ' +
  'no momento da atribuição não é conhecido — a Meta não expõe o destino que um ' +
  'conjunto tinha no passado, e projetar o atual para trás seria inventar histórico.';

export const OBSERVED_ATTRIBUTION_DESTINATION_VARIATION_LIMITATION =
  'O anúncio é o mesmo em todas as observações, mas o destino do conjunto foi ' +
  'visto diferente entre elas. Cada leitura é verdadeira no seu próprio momento; ' +
  'não existe um destino único válido para a conversa inteira.';

export const OBSERVED_ATTRIBUTION_DESTINATION_UNDEFINED_LIMITATION =
  'A Meta respondeu UNDEFINED para o destino deste conjunto: o destino foi ' +
  'perguntado e não há um configurado. É diferente de não termos observado ainda.';

export const OBSERVED_ATTRIBUTION_DESTINATION_OBSERVED_LIMITATION =
  'O destino é o último observado antes desta conversa, não o destino em vigor ' +
  'no instante dela. A Meta não informa quando um destino muda, então entre duas ' +
  'observações o valor é desconhecido.';

export const OBSERVED_ATTRIBUTION_DESTINATION_MULTI_LIMITATION =
  'messaging_multi significa que o conjunto ofereceu mais de um aplicativo e a ' +
  'Meta roteia por pessoa. O app final desta conversa não é determinável pelo ' +
  'conjunto — só pelo canal em que ela chegou.';

/** Named here so the projector can state its own layer without a literal. */
export const OBSERVED_ATTRIBUTION_PROJECTOR =
  'observed attribution bridge (intelligence-analytics)' as const;
