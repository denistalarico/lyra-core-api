import type {
  BusinessModeDimension,
  BusinessModeTemporalSemantics,
} from '../../common/intelligence';

/**
 * The shape of an aggregate over individually-observed attributions.
 *
 * `kind` first, for the reason every view in this module puts it first: a
 * consumer must be able to tell what class of claim it holds before reading a
 * number. `cohort_correlation` (I3.5) correlates spend with outcomes by period
 * and attributes nothing. `observed_attribution` (I4) is one conversation with
 * provider evidence. This one is the sum of *those* — every conversation
 * counted here carries its own observed identifier, and none was inferred.
 */
export type ObservedAttributionSummaryKind = 'observed_attribution_summary';

/**
 * The level a group key names.
 *
 * Four of them are Meta's hierarchy. `destination` (I4.3) is not a fifth level
 * of it — it is an orthogonal axis, and the difference matters when reading the
 * numbers:
 *
 * - The hierarchy levels *partition* the matched conversations. Every matched
 *   conversation lands in exactly one account, one campaign, one ad set and one
 *   ad, so those groups always sum back to `matchedConversations`.
 * - `destination` does **not** partition them. A conversation whose ad set was
 *   re-pointed between two observed clicks has no single destination and is
 *   deliberately placed in no group (§6), so the destination groups sum to
 *   `destinationResolvedConversations` instead — which is why that figure is
 *   reported rather than left to be inferred from a subtraction.
 */
export type ObservedAttributionGroupBy =
  | 'account'
  | 'campaign'
  | 'adset'
  | 'ad'
  | 'destination';

/**
 * How the window selects conversations.
 *
 * Stated in the response rather than assumed, because the two plausible
 * readings produce different numbers from the same data and a reader cannot
 * tell them apart from the figures alone:
 *
 * - `entry_cohort` — the window selects conversations whose **first observed
 *   attribution** falls inside it, and their outcomes are followed forward
 *   without limit. A conversation that entered on the last day and closed a
 *   month later counts as won here.
 *
 * I3's period views use event-window semantics instead (an event counts in the
 * window it occurred in), and the two must never be read as comparable. This
 * one is a true funnel of a fixed set of conversations; that one is a picture
 * of a period's activity.
 */
export type ObservedAttributionCohortSemantics = 'entry_cohort';

export type ObservedAttributionSummaryCohort = {
  /** Inclusive first day, in the ad account's own timezone. */
  from: string;
  /** Inclusive last day, same zone. */
  until: string;
  /** The zone the days were cut in, and where it came from. */
  timezone: string;
  timezoneSource: 'ad_account' | 'utc_fallback';
  /**
   * When the aggregate was computed.
   *
   * Required by §11: outcomes are followed past the window, so the answer for a
   * recent cohort changes every time it is asked. Without this a reader cannot
   * tell a cohort that produced nothing from one that has not finished yet.
   */
  dataAsOf: string;
  semantics: ObservedAttributionCohortSemantics;
  /**
   * The latest entry instant in this cohort, or null when it is empty.
   *
   * Together with `dataAsOf` it is what makes `immatureCohort` checkable rather
   * than a bare flag a reader has to trust.
   */
  latestAttributionAt: string | null;
  /**
   * Hours between the newest attribution and `dataAsOf`.
   *
   * Null for an empty cohort — an age needs something to be the age of.
   */
  cohortAgeHours: number | null;
};

/**
 * How many conversations could have been attributed, and how many were.
 *
 * The denominator is the honest one §16 demands: conversations on a channel
 * whose provider actually reports an ad id. Instagram and Messenger threads are
 * counted in `unsupportedConversations` and excluded from the ratio — they are
 * *unsupported*, not unattributed, and folding them in would make the coverage
 * figure fall as those channels grow while describing nothing but channel mix.
 */
export type ObservedAttributionSummaryCoverage = {
  eligibleConversations: number;
  /** Conversations whose observed ad resolved to exactly one ad in the mirror. */
  matchedConversations: number;
  /** Observed conflicting ads. Counted here, never placed in a group. */
  conflictingConversations: number;
  /**
   * Observed an ad id that did not resolve in this connection's mirror.
   *
   * The aggregate's counterpart to `ad_not_found`. Kept out of every group for
   * the same reason a conflict is: there is no ad to attribute it to.
   */
  unresolvedConversations: number;
  /** On a channel that cannot carry a referral at all. */
  unsupportedConversations: number;
  /**
   * `matchedConversations / eligibleConversations`, or null.
   *
   * Null rather than zero when the denominator is zero. A ratio over nothing is
   * not 0% — it is undefined, and rendering it as 0% would show a client with no
   * eligible conversations a headline saying attribution is failing.
   */
  observedCoverage: number | null;
};

/**
 * How much of the *matched* cohort could be placed at a destination.
 *
 * §17 insists these are two different measurements and they are reported as two
 * objects rather than merged fields, because merging them produces a number
 * nobody can act on:
 *
 * - **Attribution coverage** (`ObservedAttributionSummaryCoverage`) asks how
 *   many eligible conversations carried provider evidence at all. A low figure
 *   is about referral capture.
 * - **Destination coverage** (this) asks, of the ones that did, how many could
 *   be placed at a single destination. A low figure is about how long the
 *   destination observer has been running and how often ad sets are re-pointed.
 *
 * The denominator here is `matchedConversations`, never `eligibleConversations`
 * — a conversation with no attribution has no ad set whose destination could
 * even be asked about, and counting it as a destination failure would blame this
 * enrichment for a gap in the layer beneath it.
 */
export type ObservedAttributionDestinationCoverage = {
  /** The denominator: conversations with a resolved single ad. */
  matchedConversations: number;
  /** Placed at exactly one destination, and therefore in a group. */
  destinationResolvedConversations: number;
  /**
   * Matched, but the destination observer had seen nothing about the ad set
   * before the click.
   *
   * §7's first cause, and kept apart from `unknown` for the whole slice's
   * reason: this says *we had not looked yet*, which is a fact about Lyra's
   * observation history and is fixed by time passing. It is not a statement
   * about the ad.
   */
  destinationUnavailableConversations: number;
  /**
   * Matched and consistently attributed, but the ad set pointed somewhere else
   * between two of the conversation's own observations.
   *
   * §6 requires this be its own counter rather than folded into a generic
   * unresolved bucket: the destination evidence here is *present and good*, and
   * there are simply two true answers. Hiding it would make a real and
   * interesting fact about the account look like missing data.
   */
  destinationTemporalVariationConversations: number;
  /**
   * Matched, but the ad's ad set never resolved in the mirror.
   *
   * Destination is an ad-set property in Meta's model, so an ad whose parent
   * did not sync has nothing to carry destination evidence about. Distinct from
   * `unavailable`, which *has* an ad set and no observation of it yet.
   */
  destinationAdsetUnresolvedConversations: number;
  /**
   * `destinationResolved / matched`, or null on a zero denominator.
   *
   * Null rather than zero for the same reason `observedCoverage` is: a ratio
   * over nothing is undefined, and rendering 0% would tell a client whose
   * cohort is empty that destination enrichment is broken.
   */
  destinationCoverage: number | null;
};

/** One hierarchy node's attributed funnel. */
export type ObservedAttributionSummaryGroup = {
  /**
   * The provider-side id at `level` — or, when `level` is `destination`, the
   * canonical destination itself (`whatsapp`, `messaging_multi`, `unknown`, …).
   *
   * The destination keys come from the existing canonical vocabulary rather
   * than a catalogue of this view's own (§8): a second enum would let the same
   * ad set read as `whatsapp` here and `WHATSAPP` in the per-conversation view.
   */
  key: string;
  level: ObservedAttributionGroupBy;
  /**
   * Provider-authored name, display only — never a join key.
   *
   * Always null for a destination group: the key *is* the human-readable value,
   * and a translated label here would become the thing a consumer matches on.
   */
  name: string | null;
  /**
   * Conversations attributed to this node, counted once each.
   *
   * §3: a conversation with three observations of the same ad is one attributed
   * conversation. `observationsCount` carries the other number.
   */
  attributedConversations: number;
  /** Observations carrying an ad id across those conversations. */
  observationsCount: number;
  /** Attributed conversations with a recorded qualification transition. */
  qualifiedConversations: number;
  /** Opportunities explicitly linked to those conversations. */
  opportunities: number;
  wonOpportunities: number;
  /**
   * Summed value of won opportunities, or null when they span currencies.
   *
   * §14: no conversion, no FX, no silent sum. `currency` says which unit the
   * total is in, and is null exactly when the total is.
   */
  wonOpportunityValue: string | null;
  currency: string | null;
  /** Whether more than one currency appeared among this group's won deals. */
  multiCurrency: boolean;
};

export type ObservedAttributionSummaryProvenance = {
  observation: string;
  conversation: string;
  paidMedia: string;
  /**
   * Where destination evidence came from — its own layer, never folded into
   * `paidMedia` (§19).
   *
   * The hierarchy and the destination timeline are different kinds of claim
   * about the same ad set: one is current structure, the other is an append-only
   * record of what was observed when. Flattening them would let a reader believe
   * the destination was resolved by the same mechanism that resolved the
   * campaign, which is exactly the current-state-as-history error the
   * observations table was built to remove.
   */
  destination: string;
  qualification: string;
  opportunity: string;
  projector: string;
};

export type ObservedAttributionSummaryDataQuality = {
  /**
   * Always true, and stated rather than implied.
   *
   * Every conversation in every group carries its own provider-observed
   * identifier. Nothing here was inferred from proximity, channel or spend —
   * which is exactly what distinguishes this view from I3.5, whose same-named
   * flag is always `false`.
   */
  individualAttributionOnly: true;
  /** The channel and provider that can carry evidence today. */
  supportedProviderCoverage: {
    channelType: string;
    provider: string;
  };
  conflicts: number;
  unresolved: number;
  /**
   * Whether the newest attribution is recent enough that outcomes may still be
   * pending.
   *
   * Recency, not a benchmark. §11 is explicit that no maturity model is being
   * invented: the flag says "this cohort is young", and the threshold below is
   * a reporting convention rather than a claim about sales cycles.
   */
  immatureCohort: boolean;
  /** Whether every group could state a single-currency total. */
  currencyCompatibility: 'single' | 'mixed' | 'none';
  /**
   * Destination enrichment quality, reported at every `groupBy` and not only at
   * `destination`.
   *
   * Deliberate: a reader comparing campaigns should be able to see that only
   * 40% of the cohort has resolvable destinations *before* they switch axes and
   * draw a conclusion from partial groups.
   *
   * `individualAttributionOnly` stays `true` regardless (§18). Destination is an
   * enrichment of an attribution that was already individually observed — it
   * adds a property to a matched conversation and never creates, infers or
   * widens the match itself.
   */
  destinationCoverage: number | null;
  destinationUnavailable: number;
  destinationTemporalVariation: number;
  /**
   * Whether the context's Business Mode is usable, and under what time
   * semantics (I5 §22).
   *
   * The same shape I3 reports, from the same helper, so a consumer reading both
   * endpoints does not have to learn two encodings of one idea.
   */
  businessMode: {
    configured: boolean;
    recognized: boolean;
    temporalSemantics: BusinessModeTemporalSemantics;
  };
  limitations: string[];
};

export type ObservedAttributionSummaryView = {
  kind: ObservedAttributionSummaryKind;
  cohort: ObservedAttributionSummaryCohort;
  groupBy: ObservedAttributionGroupBy;
  coverage: ObservedAttributionSummaryCoverage;
  /**
   * Destination enrichment coverage — a sibling of `coverage`, not a field
   * inside it (§17).
   *
   * Additive: a consumer written against I4.2 reads `coverage` exactly as
   * before and ignores this, which is what makes `groupBy=destination` a
   * backward-compatible addition rather than a new endpoint.
   */
  destinationCoverage: ObservedAttributionDestinationCoverage;
  /**
   * The context's current Business Mode (I5).
   *
   * At the response level and **not** inside each group, which §12 requires and
   * which is also the only shape that is true: the mode belongs to the tenant /
   * workspace / client this query ran for, and every group in the response was
   * produced under that same one. Repeating it per group would present a
   * context property as though it varied by campaign or destination, and would
   * invite exactly the reading — "this campaign's mode" — that no storage here
   * supports.
   *
   * Additive and inert. It changes no grouping, no matching and no count; §12
   * is explicit that attribution must not become mode-aware, and nothing in the
   * projector reads this value back.
   */
  businessMode: BusinessModeDimension;
  groups: ObservedAttributionSummaryGroup[];
  provenance: ObservedAttributionSummaryProvenance;
  dataQuality: ObservedAttributionSummaryDataQuality;
};

/**
 * A cohort newer than this may not have finished producing outcomes.
 *
 * 72 hours, and it is a reporting convention rather than a claim about how long
 * deals take. §11 forbids inventing a maturity benchmark, so this flags recency
 * and nothing more — the reader still has `cohortAgeHours`, `dataAsOf` and
 * `latestAttributionAt` to judge with.
 */
export const OBSERVED_ATTRIBUTION_IMMATURE_COHORT_HOURS = 72;

export const OBSERVED_ATTRIBUTION_SUMMARY_OBSERVED_ONLY_LIMITATION =
  'Só entram conversas com identificador de anúncio reportado pelo provedor. ' +
  'Não há atribuição modelada, probabilística ou multi-toque — uma conversa sem ' +
  'evidência simplesmente não aparece em nenhum grupo.';

export const OBSERVED_ATTRIBUTION_SUMMARY_PROVIDER_LIMITATION =
  'Somente o WhatsApp da Meta reporta o anúncio de origem hoje. Este resumo não ' +
  'cobre Instagram, Messenger nem o restante do LeadFlow, e a cobertura é ' +
  'calculada apenas sobre conversas de canais que conseguem carregar essa ' +
  'evidência.';

export const OBSERVED_ATTRIBUTION_SUMMARY_ABSENCE_LIMITATION =
  'Ausência de referral não significa origem orgânica. A Meta pode não ter ' +
  'enviado o referral, e a captura só existe para mensagens recebidas após o ' +
  'deploy — conversas anteriores são permanentemente não atribuíveis.';

export const OBSERVED_ATTRIBUTION_SUMMARY_CAUSALITY_LIMITATION =
  'Vínculo observado, não causal. O provedor reportou que estas conversas ' +
  'começaram após um clique nestes anúncios; isso não prova que os anúncios ' +
  'causaram as qualificações ou as vendas.';

export const OBSERVED_ATTRIBUTION_SUMMARY_OPPORTUNITY_LIMITATION =
  'Oportunidades entram apenas por vínculo explícito com a conversa. Não há ' +
  'correspondência por contato, telefone, e-mail ou proximidade de data.';

export const OBSERVED_ATTRIBUTION_SUMMARY_IMMATURE_LIMITATION =
  'Esta coorte é recente: conversas atribuídas há poucas horas ainda podem virar ' +
  'oportunidade ou venda. Um número baixo aqui não é necessariamente desempenho ' +
  'ruim — pode ser apenas maturidade insuficiente.';

export const OBSERVED_ATTRIBUTION_SUMMARY_VALUE_LIMITATION =
  'wonOpportunityValue é a soma dos valores digitados pelos vendedores nas ' +
  'oportunidades, não receita faturada ou reconciliada com o Financeiro.';

export const OBSERVED_ATTRIBUTION_SUMMARY_CURRENCY_LIMITATION =
  'Há oportunidades ganhas em moedas diferentes no mesmo grupo. O total não é ' +
  'somado nem convertido: seria preciso uma taxa de câmbio que esta camada não ' +
  'tem e não inventa.';

export const OBSERVED_ATTRIBUTION_SUMMARY_SPEND_LIMITATION =
  'Este resumo não inclui investimento, ROAS, CPA nem CPL. Custo vem de fatos ' +
  'agregados de mídia, cuja semântica de período é diferente da cadeia ' +
  'individual medida aqui; juntar os dois exigiria uma decisão de modelagem que ' +
  'esta etapa não toma.';

export const OBSERVED_ATTRIBUTION_SUMMARY_CONFLICT_LIMITATION =
  'Conversas com anúncios diferentes observados ficam fora de todos os grupos. ' +
  'Os cliques são reais, mas dividi-los entre anúncios ou escolher um exigiria ' +
  'um modelo de atribuição que esta camada não aplica.';

export const OBSERVED_ATTRIBUTION_SUMMARY_UNRESOLVED_LIMITATION =
  'Conversas cujo anúncio observado não existe no espelho desta conexão ficam ' +
  'fora dos grupos. Ou a hierarquia ainda não foi sincronizada, ou o anúncio ' +
  'pertence a outra conta.';

export const OBSERVED_ATTRIBUTION_SUMMARY_DESTINATION_LIMITATION =
  'O destino é enriquecimento temporal observado, não parte da atribuição. Ele ' +
  'diz para onde o conjunto apontava no instante de cada clique, segundo o que ' +
  'a Lyra tinha observado até ali — a Meta não informa quando a configuração ' +
  'mudou, apenas como ela está quando perguntamos.';

export const OBSERVED_ATTRIBUTION_SUMMARY_DESTINATION_UNAVAILABLE_LIMITATION =
  'Parte das conversas atribuídas não tem destino porque a observação de ' +
  'destino começou depois do clique. Não é destino desconhecido: é ausência de ' +
  'observação anterior, e projetar o destino atual para trás transformaria ' +
  'configuração de hoje em histórico.';

export const OBSERVED_ATTRIBUTION_SUMMARY_DESTINATION_VARIATION_LIMITATION =
  'Conversas cujo conjunto mudou de destino entre duas observações da mesma ' +
  'conversa ficam fora de todos os grupos de destino. A atribuição continua ' +
  'válida e elas seguem contadas na cobertura; escolher um dos destinos ' +
  'apagaria a variação que a evidência registra.';

export const OBSERVED_ATTRIBUTION_SUMMARY_MESSAGING_MULTI_LIMITATION =
  'messaging_multi é um destino real, não um destino indefinido: o anunciante ' +
  'ofereceu mais de um aplicativo e a Meta roteia para o escolhido. Este ' +
  'agrupamento não identifica qual aplicativo recebeu a pessoa, e deduzi-lo do ' +
  'canal de entrada seria inferir o destino a partir da chegada.';

export const OBSERVED_ATTRIBUTION_SUMMARY_DESTINATION_NOT_ATTRIBUTION_LIMITATION =
  'Destino não cria atribuição. Só entram aqui conversas que já tinham ' +
  'identificador de anúncio observado; o destino apenas descreve para onde esse ' +
  'anúncio apontava, e nenhuma conversa passa a ser atribuída por causa dele.';

/**
 * When a destination and the channel the conversation actually arrived on do
 * not obviously correspond.
 *
 * §9 is explicit that this is *not* an error and the conversation is not
 * discarded: a conversation attributed to an ad whose ad set pointed at a
 * website is a possible fact — the person may have clicked through and messaged
 * separately, or the ad set may have been re-pointed since. Reporting it as a
 * limitation says "look at this" without asserting which reading is right.
 */
export const OBSERVED_ATTRIBUTION_SUMMARY_DESTINATION_UNUSUAL_LIMITATION =
  'Há conversas atribuídas a anúncios cujo destino observado não é um ' +
  'aplicativo de mensagens. Isso é possível e não foi descartado: pode ser ' +
  'conversa iniciada depois do clique, ou conjunto reapontado desde então. Os ' +
  'dados são exibidos como observados, sem inferir erro.';

/** Named here so the projector can state its own layer without a literal. */
export const OBSERVED_ATTRIBUTION_SUMMARY_PROJECTOR =
  'observed attribution summary (intelligence-analytics)' as const;
