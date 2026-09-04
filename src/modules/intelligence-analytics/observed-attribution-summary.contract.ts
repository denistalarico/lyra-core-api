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
 * The four levels of Meta's hierarchy, and nothing else. `destination` is
 * deliberately absent from this slice — see
 * `OBSERVED_ATTRIBUTION_SUMMARY_DESTINATION_LIMITATION`.
 */
export type ObservedAttributionGroupBy =
  | 'account'
  | 'campaign'
  | 'adset'
  | 'ad';

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

/** One hierarchy node's attributed funnel. */
export type ObservedAttributionSummaryGroup = {
  /** The provider-side id at `level`. */
  key: string;
  level: ObservedAttributionGroupBy;
  /** Provider-authored name, display only — never a join key. */
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
  limitations: string[];
};

export type ObservedAttributionSummaryView = {
  kind: ObservedAttributionSummaryKind;
  cohort: ObservedAttributionSummaryCohort;
  groupBy: ObservedAttributionGroupBy;
  coverage: ObservedAttributionSummaryCoverage;
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
  'Este resumo não agrupa por destino. O destino é temporal e resolvido por ' +
  'observação individual (I4.1): uma conversa cujo conjunto mudou de destino ' +
  'entre dois cliques não pertence a um destino único, e colapsá-la em um ' +
  'bucket apagaria exatamente a variação que a evidência registra.';

/** Named here so the projector can state its own layer without a literal. */
export const OBSERVED_ATTRIBUTION_SUMMARY_PROJECTOR =
  'observed attribution summary (intelligence-analytics)' as const;
