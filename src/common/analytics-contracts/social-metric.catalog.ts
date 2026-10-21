/**
 * Every metric a dashboard card can be built from, and what is true about it.
 *
 * This is the layer that lets the dashboards ship before the data does. A card
 * does not ask "did the request return something?" — it asks the catalog what
 * the metric *is*, and a metric whose ingestion has not been switched on
 * renders "Métrica ainda não disponível" instead of a zero. A zero and a
 * missing pipeline look identical on a chart and mean opposite things.
 *
 * It does not replace `socialAnalyticsKpi.ts`. That module owns the nine KPIs
 * the current overview renders, including their comparison rules, and its tests
 * pin it; this one is the wider vocabulary the configurable cards draw from,
 * and it reuses the same format and polarity unions so a value formatted by
 * either module reads the same.
 */

import type { ChannelId } from "./social-channels";
import type { SocialKpiFormat, SocialKpiPolarity } from "./social-kpi.types";

export const METRIC_IDS = [
  // Paid — available today, from SocialAdAnalyticsTotals.
  "spend",
  "impressions",
  "clicks",
  "link_clicks",
  "leads",
  "conversions",
  "conversion_value",
  "video_views",
  "messaging_conversations",
  "ctr",
  "cpc",
  "cpm",
  "cpl",
  "cpa",
  "roas",
  "cost_per_conversation",
  "period_reach",
  "frequency",
  "cpp",
  // Organic — available today, from SocialOrganicAnalyticsTotals.
  "organic_impressions",
  "organic_reach",
  // The period measurement's own figures, Instagram only. Meta returns the
  // total and the slices in one response; they overlap and must never be
  // added or subtracted from one another.
  "total_views",
  "total_views_organic",
  "total_views_paid",
  "total_reach",
  "total_reach_organic",
  "total_reach_paid",
  "feed_reach",
  // Reels and stories, from the same `media_product_type` breakdown. Each is a
  // subset of the organic slice, never a further slice beside it.
  "reel_count",
  "reel_reach",
  "reel_views",
  "reel_interactions",
  "reel_likes",
  "reel_comments",
  "reel_saves",
  "reel_shares",
  "story_count",
  "story_reach",
  "story_views",
  "story_interactions",
  "story_replies",
  "story_shares",
  // Facebook Page. Separate ids from the Instagram ones because they are
  // separate measurements, not separate spellings — see `FACEBOOK_ONLY`.
  "page_views",
  "page_reactions",
  "page_comments",
  "page_shares",
  "page_post_count",
  "page_reel_count",
  "page_reel_plays",
  "page_reel_viewers",
  "page_reel_watch_time",
  "page_reel_reactions",
  "page_reel_comments",
  "page_reel_shares",
  // Facebook Page daily series. `page_follows` is its own id rather than reusing
  // `followers_count` because the two come from different measurements: that one
  // is a profile field that only knows "now", this one is a per-day level.
  "page_follows",
  "page_daily_follows",
  "page_daily_unfollows",
  "page_views_organic",
  "page_views_paid",
  "page_new_conversations",
  "post_weekday_performance",
  "followers_count",
  "followers_gained",
  "followers_lost",
  "profile_views",
  "publications",
  // Destination funnel (I3.5).
  "conversations",
  // Account-level organic engagement. Collected all along in one call with
  // `profile_views` and kept in `provider_metrics`; migration 1795600000000
  // gave them columns and backfilled the history from that JSONB.
  "total_interactions",
  "accounts_engaged",
  "organic_likes",
  "organic_comments",
  "organic_shares",
  "organic_saves",
  "organic_replies",
  // Derived, not stored — see `DERIVED_METRICS`.
  "followers_delta",
  // Breakdowns. The paid three are ingesting today; the organic three were
  // gated off by a variable that was never set, and are on as of 2026-09-23.
  "audience_age_gender",
  // The two marginals of the cross above, each a card of its own. Derived from
  // the same stored rows and the same request — see `AGE_GENDER_MARGINAL`.
  "audience_by_age",
  "audience_by_gender",
  // Paid delivery by daypart. Impressions only — see the entry for why there is
  // no reach counterpart and why there cannot be one.
  "impressions_by_hour",
  "spend_by_hour",
  "followers_gender",
  "followers_city",
  // Organic follower demographics, the account's own snapshot — distinct from
  // the paid `audience_age_gender`, which describes who the ads reached.
  "organic_audience_age_gender",
  // When followers are online, from the hourly grid. Both read one collection.
  "best_weekday",
  "best_hour",
  "reach_by_device",
  "spend_by_publisher",
  "clicks_by_publisher",
  "reach_by_publisher",
  "impressions_by_publisher",
  // Video completion, requested as of 2026-09-23. No history before that.
  "thruplays",
  "video_avg_watch_seconds",
  // Inventory counts.
  "campaigns_count",
  "ads_count",
  "boosted_publications",
  /**
   * The summary block: one figure per question, across every channel.
   *
   * Prefixed `summary_` rather than reusing `impressions` and friends, because
   * they are different measurements that happen to share a name. `impressions`
   * is the ad account's; `summary_impressions` is that plus both pages'. A card
   * showing one where the operator expected the other is a wrong number with a
   * right label, so the ids keep them apart.
   */
  "summary_spend",
  "summary_reach",
  "summary_impressions",
  "summary_clicks",
  "summary_ads",
  "summary_publications",
  "summary_new_followers",
  "summary_engagement",
] as const;

export type MetricId = (typeof METRIC_IDS)[number];

/**
 * How ready a metric is, which is what the card renders instead of a number
 * when it is not `available`.
 *
 * - `available` — read today from an endpoint that exists.
 * - `requires_breakdown_ingest` — the table and the reader exist (Etapa 2A) but
 *   the ingestion is behind a kill switch that is OFF by default, so the honest
 *   state is "not collected yet", not "zero".
 * - `not_integrated` — no pipeline of any kind. Google Ads, and the two metrics
 *   (§2) that were requested without a source behind them.
 */
export type MetricAvailability =
  | "available"
  | "requires_breakdown_ingest"
  | "not_integrated";

export type MetricSource =
  | "paid"
  | "organic"
  | "boost"
  | "destination"
  /**
   * Composed from the other sources rather than read from one.
   *
   * The summary block's metrics add a paid reading to an organic one — total
   * impressions are the ad account's plus the two pages'. They are their own
   * source because nothing else about them is shared: they have no single
   * endpoint, no single grain, and the card reads them from a value builder
   * that already holds both overviews.
   */
  | "summary";

/**
 * The shape a metric's reading actually has, which decides the card that can
 * show it.
 *
 * A KPI tile renders one number. That is right for spend or impressions and
 * wrong for a distribution: "Cidades com mais seguidores" is a list of city/count
 * pairs, and "Seguidores por gênero" is a set of buckets. Rendering either as a
 * tile leaves the card with no number it could honestly display — which is
 * exactly what shipped, and why the operator saw every metric as a KPI.
 *
 * - `scalar` — one number for the period. A KPI tile, and the only shape that
 *   can sit in a funnel step.
 * - `distribution` — buckets over one dimension (gender, age, device, network).
 *   Reads as a chart; a table is a legitimate alternative the operator can
 *   switch to.
 * - `ranking` — an ordered list where the labels are open-ended and long
 *   (cities). Reads as a table: a bar chart of 40 city names is unreadable,
 *   and truncating it to the top 5 answers a different question.
 */
export type MetricShape = "scalar" | "distribution" | "ranking";

/** The card kind a shape opens as. */
export const DEFAULT_CARD_KIND: Record<MetricShape, "kpi" | "chart" | "table"> =
  {
    scalar: "kpi",
    distribution: "chart",
    ranking: "table",
  };

/**
 * What one reading of a metric actually counts, which is what decides whether
 * two of them may be divided by one another.
 *
 * The funnel (Etapa 7) is the only consumer so far, and it is the reason the
 * field exists: a step-to-step rate is a division, and a division of two numbers
 * counted over different cohorts is not a rate at all. The failure is the one
 * recorded in `project_social_i3_3_temporal_facts` — a conversation opened on
 * the 31st and qualified on the 2nd puts numerator and denominator in windows
 * that only partly overlap, so the quotient describes nothing.
 *
 * - `paid_period` — a Meta Ads insight aggregated over the selected period at
 *   `entity_level='account'`. Every step of the default funnel is one of these,
 *   which is precisely why its rates are legitimate.
 * - `paid_period_deduplicated` — measured over the period as a whole rather than
 *   summed from days (`periodReach`). It shares the period and the cohort with
 *   `paid_period`, so rates against it hold; what it must never do is be
 *   reconstructed by addition.
 * - `organic_period` — read from the organic endpoints, a different account and
 *   a different collection.
 * - `snapshot` — a lifetime figure read at a point in time (follower counts,
 *   audience demographics). Not a flow, so it has no period to share.
 * - `event_window` — counted by the event falling inside the window, from a
 *   cohort that opened elsewhere. The case the memory documents.
 */
export type MetricGrain =
  | "paid_period"
  | "paid_period_deduplicated"
  | "organic_period"
  | "snapshot"
  | "event_window";

export type MetricDefinition = {
  id: MetricId;
  label: string;
  /** Shown in the card's "?" tooltip. Written for an operator, not a developer. */
  description: string;
  channels: ChannelId[];
  format: SocialKpiFormat;
  polarity: SocialKpiPolarity;
  /**
   * Whether the metric may be summed across days.
   *
   * False for every flavour of reach and for follower counts. Reach is unique
   * people, so two days of 1.000 is not 2.000 (§2.1); a follower count is a
   * lifetime snapshot, so summing it would count the same follower once per
   * day. A card whose metric is non-additive must read a period figure that was
   * measured as a period — `periodReach` — or render an empty state.
   */
  additive: boolean;
  source: MetricSource;
  availability: MetricAvailability;
  /**
   * What the number counts. Two metrics of different grains may sit side by
   * side, but a rate between them is not computable — see `MetricGrain`.
   */
  grain: MetricGrain;

  /**
   * Whether the reading is one number or a set of buckets.
   *
   * Optional, defaulting to `scalar`: most of the catalog is scalar and
   * annotating each one would bury the handful that are not. Read it through
   * `metricShape()` rather than directly.
   */
  shape?: MetricShape;
};

/** A metric's shape, defaulting to `scalar`. */
export function metricShape(metric: MetricDefinition): MetricShape {
  return metric.shape ?? "scalar";
}

const PAID_CHANNELS: ChannelId[] = ["meta_ads"];
const META_SURFACES: ChannelId[] = ["facebook", "instagram"];
/**
 * Metrics only Instagram can answer.
 *
 * Not a narrowing for tidiness: Meta retired the Facebook Page equivalents
 * (`page_impressions_unique`) and Page posts carry no `media_product_type`, so
 * the period measurement and everything derived from the surface breakdown have
 * no source on that side. Offering them on a Facebook dashboard would produce
 * cards that are empty forever and look like a broken pipeline.
 */
const INSTAGRAM_ONLY: ChannelId[] = ["instagram"];

/**
 * Metrics only a Facebook Page reports.
 *
 * The mirror of `INSTAGRAM_ONLY`, and narrowed for the same kind of reason
 * rather than for tidiness. `page_media_view` counts Page content appearing on
 * screen and has no Instagram equivalent; the reel figures come from
 * `/{reel}/video_insights`, an edge Instagram media do not have, with metric
 * names Instagram refuses.
 *
 * The notable absence is a Page reach or "Visualizadores" card. Meta retired
 * every unique-audience metric a Page reported — `page_impressions_unique`,
 * `page_views_unique`, `page_content_viewers` and a dozen other spellings all
 * answer `(#100) The value must be a valid insights metric`, the same error an
 * invented name gets. A card for it would be empty forever and read as a broken
 * pipeline rather than as a limit of the API. Unique viewers survive in exactly
 * one place on this side, and it is `page_reel_viewers`.
 */
const FACEBOOK_ONLY: ChannelId[] = ["facebook"];

/**
 * The cross-channel block, and only it.
 *
 * A summary metric on a channel dashboard would be a number spanning networks
 * that tab does not claim to show — the exact confusion the one-block-one-
 * channel rule exists to prevent.
 */
const SUMMARY_ONLY: ChannelId[] = ["summary"];

export const SOCIAL_METRIC_CATALOG: MetricDefinition[] = [
  {
    id: "spend",
    label: "Valor gasto",
    description: "Total investido nos anúncios no período selecionado.",
    channels: PAID_CHANNELS,
    format: "currency",
    polarity: "neutral",
    additive: true,
    source: "paid",
    availability: "available",
    grain: "paid_period",
  },
  {
    id: "impressions",
    label: "Impressões",
    description:
      "Quantas vezes os anúncios foram exibidos. A mesma pessoa pode contar várias vezes.",
    channels: PAID_CHANNELS,
    format: "integer",
    polarity: "neutral",
    additive: true,
    source: "paid",
    availability: "available",
    grain: "paid_period",
  },
  {
    id: "clicks",
    label: "Cliques",
    description:
      "Todos os cliques no anúncio, inclusive em curtidas e comentários.",
    channels: PAID_CHANNELS,
    format: "integer",
    polarity: "higher_is_better",
    additive: true,
    source: "paid",
    availability: "available",
    grain: "paid_period",
  },
  {
    id: "link_clicks",
    label: "Cliques no link",
    description: "Cliques que levaram ao destino do anúncio.",
    channels: PAID_CHANNELS,
    format: "integer",
    polarity: "higher_is_better",
    additive: true,
    source: "paid",
    availability: "available",
    grain: "paid_period",
  },
  {
    id: "leads",
    label: "Leads",
    description: "Contatos gerados pelos anúncios no período.",
    channels: PAID_CHANNELS,
    format: "integer",
    polarity: "higher_is_better",
    additive: true,
    source: "paid",
    availability: "available",
    grain: "paid_period",
  },
  {
    id: "conversions",
    label: "Resultados",
    description:
      "Conversões atribuídas aos anúncios pela configuração da conta.",
    channels: PAID_CHANNELS,
    format: "integer",
    polarity: "higher_is_better",
    additive: true,
    source: "paid",
    availability: "available",
    grain: "paid_period",
  },
  {
    id: "conversion_value",
    label: "Valor de conversão",
    description: "Receita atribuída às conversões dos anúncios.",
    channels: PAID_CHANNELS,
    format: "currency",
    polarity: "higher_is_better",
    additive: true,
    source: "paid",
    availability: "available",
    grain: "paid_period",
  },
  {
    id: "video_views",
    label: "Visualizações de vídeo",
    description: "Reproduções contabilizadas pela plataforma no período.",
    channels: PAID_CHANNELS,
    format: "integer",
    polarity: "higher_is_better",
    additive: true,
    source: "paid",
    availability: "available",
    grain: "paid_period",
  },
  {
    id: "ctr",
    label: "CTR",
    description: "Cliques divididos por impressões.",
    channels: PAID_CHANNELS,
    format: "percent",
    polarity: "higher_is_better",
    additive: false,
    source: "paid",
    availability: "available",
    grain: "paid_period",
  },
  {
    id: "cpc",
    label: "CPC",
    description: "Custo médio por clique.",
    channels: PAID_CHANNELS,
    format: "currency",
    polarity: "lower_is_better",
    additive: false,
    source: "paid",
    availability: "available",
    grain: "paid_period",
  },
  {
    id: "cpm",
    label: "CPM",
    description: "Custo por mil impressões.",
    channels: PAID_CHANNELS,
    format: "currency",
    polarity: "lower_is_better",
    additive: false,
    source: "paid",
    availability: "available",
    grain: "paid_period",
  },
  {
    id: "cpl",
    label: "CPL",
    description: "Custo médio por lead.",
    channels: PAID_CHANNELS,
    format: "currency",
    polarity: "lower_is_better",
    additive: false,
    source: "paid",
    availability: "available",
    grain: "paid_period",
  },
  {
    id: "messaging_conversations",
    label: "Conversas iniciadas",
    description:
      "Conversas por mensagem iniciadas a partir dos anúncios. Não somar com Cadastros: numa campanha de mensagens a mesma pessoa costuma aparecer nas duas.",
    channels: PAID_CHANNELS,
    format: "integer",
    polarity: "higher_is_better",
    additive: true,
    source: "paid",
    availability: "available",
    grain: "paid_period",
  },
  {
    id: "cost_per_conversation",
    label: "Custo por conversa",
    description:
      "Investimento dividido pelas conversas iniciadas. Não é uma variação do CPR — o denominador é outro.",
    channels: PAID_CHANNELS,
    format: "currency",
    polarity: "lower_is_better",
    additive: false,
    source: "paid",
    availability: "available",
    grain: "paid_period",
  },
  {
    id: "cpa",
    label: "CPR",
    description: "Custo médio por resultado.",
    channels: PAID_CHANNELS,
    format: "currency",
    polarity: "lower_is_better",
    additive: false,
    source: "paid",
    availability: "available",
    grain: "paid_period",
  },
  {
    id: "roas",
    label: "ROAS",
    description: "Retorno sobre o investimento em anúncios.",
    channels: PAID_CHANNELS,
    format: "ratio",
    polarity: "higher_is_better",
    additive: false,
    source: "paid",
    availability: "available",
    grain: "paid_period",
  },
  {
    id: "period_reach",
    label: "Alcance",
    description:
      "Pessoas únicas alcançadas no período, medido pela própria Meta. Não é a soma dos alcances diários.",
    channels: PAID_CHANNELS,
    format: "integer",
    polarity: "higher_is_better",
    additive: false,
    source: "paid",
    availability: "available",
    grain: "paid_period_deduplicated",
  },
  {
    id: "frequency",
    label: "Frequência",
    description:
      "Quantas vezes, em média, cada pessoa alcançada viu os anúncios. Só é calculada nos períodos em que a Meta mediu o alcance.",
    channels: PAID_CHANNELS,
    format: "ratio",
    polarity: "neutral",
    additive: false,
    source: "paid",
    availability: "available",
    // Shares `period_reach`'s denominator, so it shares its grain: a single
    // de-duplicated measurement of the period, never a sum over days.
    grain: "paid_period_deduplicated",
  },
  {
    id: "cpp",
    label: "Custo por pessoa",
    description:
      "Quanto custou alcançar cada pessoa. Diferente do CPM, que divide por mil exibições e conta a mesma pessoa várias vezes.",
    channels: PAID_CHANNELS,
    format: "currency",
    polarity: "lower_is_better",
    additive: false,
    source: "paid",
    availability: "available",
    grain: "paid_period_deduplicated",
  },
  {
    id: "organic_impressions",
    label: "Impressões orgânicas",
    description: "Exibições das publicações não patrocinadas.",
    channels: META_SURFACES,
    format: "integer",
    polarity: "neutral",
    additive: true,
    source: "organic",
    availability: "available",
    grain: "organic_period",
  },
  {
    id: "organic_reach",
    label: "Alcance orgânico",
    description:
      "Pessoas únicas alcançadas pelas publicações. Disponível por dia; o alcance do período ainda não é medido.",
    channels: META_SURFACES,
    format: "integer",
    polarity: "higher_is_better",
    additive: false,
    source: "organic",
    availability: "available",
    grain: "organic_period",
  },
  /*
   * The period measurement, Instagram only.
   *
   * Seven metrics from one pair of API calls. They are listed separately rather
   * than as one card with a breakdown because an operator asks for them
   * separately — "quantas visualizações tivemos" and "quanto disso foi pago"
   * are two questions — and because the slices overlap the total, so a single
   * stacked card would have to either mislead or refuse to draw.
   *
   * `INSTAGRAM_ONLY`: Meta retired the Facebook Page equivalents
   * (`page_impressions_unique`) and Page posts carry no `media_product_type`,
   * so there is nothing to read on that side. Listing them for Facebook would
   * put permanently empty cards on that dashboard.
   */
  {
    id: "total_views",
    label: "Visualizações totais",
    description:
      "Quantas vezes o conteúdo foi visto ou reproduzido no período, incluindo reels, publicações, stories e anúncios. Medido pela Meta para o período inteiro, não é a soma dos dias. É o que a Meta chamava de Impressões.",
    channels: INSTAGRAM_ONLY,
    format: "integer",
    polarity: "higher_is_better",
    additive: false,
    source: "organic",
    availability: "available",
    grain: "organic_period",
  },
  {
    id: "total_views_organic",
    label: "Visualizações orgânicas",
    description:
      "A parte das visualizações que veio de conteúdo não patrocinado. Não subtraia das totais para achar as pagas: a Meta conta de forma independente e as fatias se sobrepõem. É o que a Meta chamava de Impressões orgânicas.",
    channels: INSTAGRAM_ONLY,
    format: "integer",
    polarity: "higher_is_better",
    additive: false,
    source: "organic",
    availability: "available",
    grain: "organic_period",
  },
  {
    id: "total_views_paid",
    label: "Visualizações pagas",
    description:
      "A parte das visualizações que veio de anúncios, medida pela própria Meta. É o que a Meta chamava de Impressões pagas.",
    channels: INSTAGRAM_ONLY,
    format: "integer",
    polarity: "neutral",
    additive: false,
    source: "organic",
    availability: "available",
    grain: "organic_period",
  },
  {
    id: "total_reach",
    label: "Alcance total",
    description:
      "Contas únicas que viram seu conteúdo — posts, stories, reels e anúncios — pelo menos uma vez no período. A Meta informa que a métrica ainda está em desenvolvimento e que o total pode não bater com a soma das partes: quem deixa de seguir é contado uma vez só, e quem foi alcançado de forma orgânica e paga também.",
    channels: INSTAGRAM_ONLY,
    format: "integer",
    polarity: "higher_is_better",
    additive: false,
    source: "organic",
    availability: "available",
    grain: "organic_period",
  },
  {
    id: "total_reach_organic",
    label: "Alcance orgânico (período)",
    description:
      "Contas únicas alcançadas por conteúdo não patrocinado no período. Somada ao alcance pago, dá mais que o total: quem foi alcançado das duas formas aparece nas duas fatias e uma vez só no total.",
    channels: INSTAGRAM_ONLY,
    format: "integer",
    polarity: "higher_is_better",
    additive: false,
    source: "organic",
    availability: "available",
    grain: "organic_period",
  },
  {
    id: "total_reach_paid",
    label: "Alcance pago (período)",
    description: "Contas únicas alcançadas por anúncios no período.",
    channels: INSTAGRAM_ONLY,
    format: "integer",
    polarity: "neutral",
    additive: false,
    source: "organic",
    availability: "available",
    grain: "organic_period",
  },
  {
    id: "feed_reach",
    label: "Alcance das postagens",
    description:
      "Contas únicas que viram suas publicações do feed pelo menos uma vez no período. Considera apenas o feed: reels e stories ficam de fora. A Meta informa que esta métrica ainda está em desenvolvimento.",
    channels: INSTAGRAM_ONLY,
    format: "integer",
    polarity: "higher_is_better",
    additive: false,
    source: "organic",
    availability: "available",
    grain: "organic_period",
  },
  {
    id: "reel_count",
    label: "Número de reels",
    description:
      'Reels publicados no período. Contado a partir das publicações, não medido pela Meta — não existe métrica de "quantos reels".',
    channels: INSTAGRAM_ONLY,
    format: "integer",
    polarity: "neutral",
    // Additive across periods in principle, but the card never adds: the count
    // is already the answer for the window asked for.
    additive: false,
    source: "organic",
    availability: "available",
    grain: "organic_period",
  },
  {
    id: "reel_reach",
    label: "Alcance dos reels",
    description:
      "Contas únicas que visualizaram seus reels pelo menos uma vez no período. Considera apenas reels: publicações do feed e stories ficam de fora. A Meta informa que esta métrica ainda está em desenvolvimento.",
    channels: INSTAGRAM_ONLY,
    format: "integer",
    polarity: "higher_is_better",
    additive: false,
    source: "organic",
    availability: "available",
    grain: "organic_period",
  },
  {
    id: "reel_views",
    label: "Visualizações dos reels",
    description:
      "Número de vezes que seus reels foram reproduzidos no período. Considera apenas visualizações orgânicas dos reels.",
    channels: INSTAGRAM_ONLY,
    format: "integer",
    polarity: "higher_is_better",
    additive: false,
    source: "organic",
    availability: "available",
    grain: "organic_period",
  },
  {
    id: "reel_interactions",
    label: "Interações nos reels",
    description:
      "Curtidas, salvos, comentários e compartilhamentos dos reels, menos descurtidas, remoções de salvo e comentários excluídos. Considera as interações no período, independentemente da data em que o reel foi publicado. Esta métrica está em desenvolvimento.",
    channels: INSTAGRAM_ONLY,
    format: "integer",
    polarity: "higher_is_better",
    additive: false,
    source: "organic",
    availability: "available",
    grain: "organic_period",
  },
  {
    id: "reel_likes",
    label: "Curtidas nos reels",
    description: "Curtidas nos seus reels no período.",
    channels: INSTAGRAM_ONLY,
    format: "integer",
    polarity: "higher_is_better",
    additive: false,
    source: "organic",
    availability: "available",
    grain: "organic_period",
  },
  {
    id: "reel_comments",
    label: "Comentários nos reels",
    description: "Comentários nos seus reels no período.",
    channels: INSTAGRAM_ONLY,
    format: "integer",
    polarity: "higher_is_better",
    additive: false,
    source: "organic",
    availability: "available",
    grain: "organic_period",
  },
  {
    id: "reel_saves",
    label: "Salvamentos dos reels",
    description: "Vezes que seus reels foram salvos no período.",
    channels: INSTAGRAM_ONLY,
    format: "integer",
    polarity: "higher_is_better",
    additive: false,
    source: "organic",
    availability: "available",
    grain: "organic_period",
  },
  {
    id: "reel_shares",
    label: "Compartilhamentos dos reels",
    description: "Vezes que seus reels foram compartilhados no período.",
    channels: INSTAGRAM_ONLY,
    format: "integer",
    polarity: "higher_is_better",
    additive: false,
    source: "organic",
    availability: "available",
    grain: "organic_period",
  },
  {
    id: "story_count",
    label: "Número de stories",
    description:
      "Stories publicados no período que a coleta capturou. Um story só pode ser lido enquanto está no ar, então este número é um piso: um story publicado e expirado entre duas capturas nunca foi registrado.",
    channels: INSTAGRAM_ONLY,
    format: "integer",
    polarity: "neutral",
    additive: false,
    source: "organic",
    availability: "available",
    grain: "organic_period",
  },
  {
    id: "story_reach",
    label: "Alcance dos stories",
    description:
      "Contas únicas que visualizaram seus stories pelo menos uma vez no período. Considera apenas stories. A Meta informa que esta métrica ainda está em desenvolvimento.",
    channels: INSTAGRAM_ONLY,
    format: "integer",
    polarity: "higher_is_better",
    additive: false,
    source: "organic",
    availability: "available",
    grain: "organic_period",
  },
  {
    id: "story_views",
    label: "Visualizações totais dos stories",
    description:
      "Número de vezes que seus stories foram visualizados ou reproduzidos desde que foram postados. Considera apenas visualizações orgânicas.",
    channels: INSTAGRAM_ONLY,
    format: "integer",
    polarity: "higher_is_better",
    additive: false,
    source: "organic",
    availability: "available",
    grain: "organic_period",
  },
  {
    id: "story_interactions",
    label: "Total de interações com stories",
    description:
      "Número total de interações com seus stories no período analisado. Esta métrica está em desenvolvimento.",
    channels: INSTAGRAM_ONLY,
    format: "integer",
    polarity: "higher_is_better",
    additive: false,
    source: "organic",
    availability: "available",
    grain: "organic_period",
  },
  {
    id: "story_replies",
    label: "Total de respostas a stories",
    description:
      "Respostas enviadas aos seus stories no período. A Meta não separa este número por superfície — ela recusa o detalhamento para respostas — então o valor é o total da conta, que na prática só os stories produzem.",
    channels: INSTAGRAM_ONLY,
    format: "integer",
    polarity: "higher_is_better",
    additive: false,
    source: "organic",
    availability: "available",
    grain: "organic_period",
  },
  {
    id: "story_shares",
    label: "Total de compartilhamentos dos stories",
    description: "Vezes que seus stories foram compartilhados no período.",
    channels: INSTAGRAM_ONLY,
    format: "integer",
    polarity: "higher_is_better",
    additive: false,
    source: "organic",
    availability: "available",
    grain: "organic_period",
  },
  {
    id: "page_views",
    label: "Total de visualizações da página",
    description:
      "Vezes que qualquer conteúdo da sua Página ou sobre sua Página entrou na tela de uma pessoa. Inclui publicações, stories, anúncios e outras informações da Página.",
    channels: FACEBOOK_ONLY,
    format: "integer",
    polarity: "higher_is_better",
    // A view count, so additive in principle. The card never adds: the figure
    // is measured for the window that was asked for.
    additive: false,
    source: "organic",
    availability: "available",
    grain: "organic_period",
  },
  {
    id: "page_reactions",
    label: "Total de reações das postagens",
    description:
      "Reações nas publicações da Página no período, somadas de todos os tipos. A divisão por emoji aparece na tabela de reações.",
    channels: FACEBOOK_ONLY,
    format: "integer",
    polarity: "higher_is_better",
    additive: false,
    source: "organic",
    availability: "available",
    grain: "organic_period",
  },
  {
    id: "page_comments",
    label: "Total de comentários nas publicações",
    description: "Comentários nas publicações da Página no período.",
    channels: FACEBOOK_ONLY,
    format: "integer",
    polarity: "higher_is_better",
    additive: false,
    source: "organic",
    availability: "available",
    grain: "organic_period",
  },
  {
    id: "page_shares",
    label: "Total de compartilhamentos",
    description: "Compartilhamentos das publicações da Página no período.",
    channels: FACEBOOK_ONLY,
    format: "integer",
    polarity: "higher_is_better",
    additive: false,
    source: "organic",
    availability: "available",
    grain: "organic_period",
  },
  {
    id: "page_post_count",
    label: "Número de publicações",
    description:
      "Publicações da Página no período. Contado a partir das publicações, não medido pela Meta.",
    channels: FACEBOOK_ONLY,
    format: "integer",
    polarity: "neutral",
    additive: false,
    source: "organic",
    availability: "available",
    grain: "organic_period",
  },
  {
    id: "page_reel_count",
    label: "Número de reels",
    description:
      "Reels publicados pela Página no período. Contado a partir das publicações, não medido pela Meta.",
    channels: FACEBOOK_ONLY,
    format: "integer",
    polarity: "neutral",
    additive: false,
    source: "organic",
    availability: "available",
    grain: "organic_period",
  },
  {
    id: "page_reel_plays",
    label: "Total de visualizações dos reels",
    description:
      "Reproduções dos reels no período, incluindo quem assistiu mais de uma vez.",
    channels: FACEBOOK_ONLY,
    format: "integer",
    polarity: "higher_is_better",
    additive: false,
    source: "organic",
    availability: "available",
    grain: "organic_period",
  },
  {
    id: "page_reel_viewers",
    label: "Total de visualizadores dos reels",
    description:
      "Contas que viram seus reels pelo menos uma vez. Somado por reel: quem viu dois reels é contado duas vezes, porque a Meta não informa o total sem repetição.",
    channels: FACEBOOK_ONLY,
    format: "integer",
    polarity: "higher_is_better",
    additive: false,
    source: "organic",
    availability: "available",
    grain: "organic_period",
  },
  {
    id: "page_reel_watch_time",
    label: "Tempo total de exibição dos reels (segundos)",
    description:
      "Tempo somado de exibição dos reels no período, em segundos, considerando todos os espectadores. A Meta reporta em milissegundos; o card converte.",
    channels: FACEBOOK_ONLY,
    // Seconds as a plain integer rather than a new `duration` KPI format: a
    // total watch time is a quantity to compare between periods, not a clock
    // reading, and "47.678" is as readable as "13:14:38" for that.
    format: "integer",
    polarity: "higher_is_better",
    additive: false,
    source: "organic",
    availability: "available",
    grain: "organic_period",
  },
  {
    id: "page_reel_reactions",
    label: "Total de curtidas dos reels",
    description: "Reações nos reels publicados no período.",
    channels: FACEBOOK_ONLY,
    format: "integer",
    polarity: "higher_is_better",
    additive: false,
    source: "organic",
    availability: "available",
    grain: "organic_period",
  },
  {
    id: "page_reel_comments",
    label: "Total de comentários dos reels",
    description: "Comentários nos reels publicados no período.",
    channels: FACEBOOK_ONLY,
    format: "integer",
    polarity: "higher_is_better",
    additive: false,
    source: "organic",
    availability: "available",
    grain: "organic_period",
  },
  {
    id: "page_reel_shares",
    label: "Total de compartilhamentos dos reels",
    description: "Compartilhamentos dos reels publicados no período.",
    channels: FACEBOOK_ONLY,
    format: "integer",
    polarity: "higher_is_better",
    additive: false,
    source: "organic",
    availability: "available",
    grain: "organic_period",
  },
  /*
   * The Page's daily series.
   *
   * `page_follows` exists alongside `followers_count` rather than replacing it
   * because they are different measurements. `followers_count` is a profile
   * field read once per sync and stamped onto the day being written, so it is
   * the right answer to "how many now" and a flat, wrong line on any chart.
   * `page_follows` is the Page insights metric that reports each day's own
   * level, and is the only one of the two a growth chart may use.
   */
  {
    id: "page_follows",
    label: "Seguidores da Página",
    description:
      "Nível de seguidores ao fim de cada dia. É esta a métrica que descreve o crescimento da Página ao longo do tempo.",
    channels: FACEBOOK_ONLY,
    format: "integer",
    polarity: "higher_is_better",
    // A stock, like `followers_count`: the level at a point in time, never a
    // sum across days.
    additive: false,
    source: "organic",
    availability: "available",
    grain: "organic_period",
  },
  {
    id: "page_daily_follows",
    label: "Novos seguidores da Página",
    description: "Contas que passaram a seguir a Página em cada dia.",
    channels: FACEBOOK_ONLY,
    format: "integer",
    polarity: "higher_is_better",
    additive: true,
    source: "organic",
    availability: "available",
    grain: "organic_period",
  },
  {
    id: "page_daily_unfollows",
    label: "Deixaram de seguir a Página",
    description: "Contas que deixaram de seguir a Página em cada dia.",
    channels: FACEBOOK_ONLY,
    format: "integer",
    polarity: "lower_is_better",
    additive: true,
    source: "organic",
    availability: "available",
    grain: "organic_period",
  },
  {
    id: "page_views_organic",
    label: "Visualizações orgânicas da Página",
    description:
      "Visualizações do conteúdo da Página que não vieram de anúncios.",
    channels: FACEBOOK_ONLY,
    format: "integer",
    // Views, not an audience: the same person seen twice counts twice, which is
    // exactly what makes this summable where reach would not be.
    additive: true,
    polarity: "higher_is_better",
    source: "organic",
    availability: "available",
    grain: "organic_period",
  },
  {
    id: "page_views_paid",
    label: "Visualizações pagas da Página",
    description: "Visualizações do conteúdo da Página entregues por anúncios.",
    channels: FACEBOOK_ONLY,
    format: "integer",
    additive: true,
    polarity: "neutral",
    source: "organic",
    availability: "available",
    grain: "organic_period",
  },
  {
    id: "page_new_conversations",
    label: "Conversas iniciadas",
    description:
      "Conversas no Messenger abertas por quem nunca havia mandado mensagem para a Página.",
    channels: FACEBOOK_ONLY,
    format: "integer",
    additive: true,
    polarity: "higher_is_better",
    source: "organic",
    availability: "available",
    grain: "organic_period",
  },
  {
    id: "followers_count",
    label: "Seguidores",
    description: "Total de seguidores no fim do período.",
    channels: META_SURFACES,
    format: "integer",
    polarity: "higher_is_better",
    additive: false,
    source: "organic",
    availability: "available",
    grain: "snapshot",
  },
  {
    id: "followers_gained",
    label: "Seguidores ganhos",
    description: "Novos seguidores no período.",
    channels: META_SURFACES,
    format: "integer",
    polarity: "higher_is_better",
    additive: true,
    source: "organic",
    availability: "available",
    grain: "organic_period",
  },
  {
    id: "followers_lost",
    label: "Seguidores perdidos",
    description: "Contas que deixaram de seguir no período.",
    channels: META_SURFACES,
    format: "integer",
    polarity: "lower_is_better",
    additive: true,
    source: "organic",
    availability: "available",
    grain: "organic_period",
  },
  {
    id: "profile_views",
    label: "Visitas ao perfil",
    description: "Aberturas do perfil no período.",
    channels: META_SURFACES,
    format: "integer",
    polarity: "higher_is_better",
    additive: true,
    source: "organic",
    availability: "available",
    grain: "organic_period",
  },
  {
    id: "publications",
    label: "Publicações",
    description: "Posts publicados no período.",
    channels: META_SURFACES,
    format: "integer",
    polarity: "neutral",
    additive: true,
    source: "organic",
    availability: "available",
    grain: "organic_period",
  },
  {
    id: "conversations",
    label: "Conversas",
    description:
      "Conversas iniciadas a partir dos anúncios de mensagem. Ainda não expomos esta métrica: ela se sobrepõe a Leads na origem e a separação exige uma decisão de produto antes da leitura.",
    // Ads only: the conversations come from ads with a messaging destination,
    // so on a Facebook or Instagram block it would be paid data under an
    // organic heading.
    channels: PAID_CHANNELS,
    format: "integer",
    polarity: "higher_is_better",
    additive: true,
    source: "destination",
    availability: "not_integrated",
    grain: "event_window",
  },
  {
    id: "audience_age_gender",
    label: "Audiência por idade e gênero",
    description: "Distribuição do público alcançado por faixa etária e gênero.",
    channels: PAID_CHANNELS,
    format: "integer",
    polarity: "neutral",
    additive: false,
    source: "paid",
    // `SOCIAL_ADS_BREAKDOWNS_ENABLED` is on and the rows are arriving —
    // verified against production on 2026-09-23. This said
    // `requires_breakdown_ingest` long after the ingest was switched on, so the
    // card showed "ainda não está sendo coletada" over data that existed.
    availability: "available",
    grain: "snapshot",
    shape: "distribution",
  },
  {
    /**
     * Age alone, summed over the genders of the stored cross.
     *
     * A card of its own rather than a rendering option on
     * `audience_age_gender`, because an operator asking "which age group" wants
     * five bars and not fifteen. Deriving it costs nothing: the cross is
     * already stored and already requested, and summing a cross down to one of
     * its margins is always valid — it is the opposite direction, splitting a
     * margin back into a cross, that cannot be done.
     *
     * Impressions are summed, as the cross's are. Reach is not summable across
     * buckets — the same person can land in two — and the breakdown view
     * already returns it null for exactly that reason, so this metric inherits
     * the honest absence rather than inventing a total.
     */
    id: "audience_by_age",
    label: "Impressões por idade",
    description:
      "Distribuição das impressões por faixa etária, somando os gêneros.",
    channels: PAID_CHANNELS,
    format: "integer",
    polarity: "neutral",
    additive: false,
    source: "paid",
    availability: "available",
    grain: "snapshot",
    shape: "distribution",
  },
  {
    /** The other margin of the same cross. See `audience_by_age`. */
    id: "audience_by_gender",
    label: "Impressões por gênero",
    description:
      "Distribuição das impressões por gênero, somando as faixas etárias.",
    channels: PAID_CHANNELS,
    format: "integer",
    polarity: "neutral",
    additive: false,
    source: "paid",
    availability: "available",
    grain: "snapshot",
    shape: "distribution",
  },
  {
    /**
     * Impressions by hour of day, and the reason there is no reach beside it.
     *
     * "Impressões e alcance por hora" was asked for as one chart. Only half of
     * it is a real measurement. Meta cuts these hours in the **viewer's**
     * timezone, and a person reached at 09h and again at 15h is one person in
     * the day's reach but appears in two dayparts — so the buckets add up to
     * more than the day. Measured on this account's own 90 days: the hourly
     * buckets sum to 3 471 people where the day-level figure is 3 066, a 13%
     * overstatement that no reader could detect from the chart.
     *
     * Impressions have no such problem: each one is counted once, under the
     * hour its viewer saw it. The same 90 days sum to 3 687 impressions from
     * the hourly buckets and 3 687 unsplit, exactly. So the daypart chart shows
     * impressions, the API returns a paid bucket's reach as null for every
     * dimension, and the question "who did I reach" keeps its honest answer at
     * the day level where it is measured.
     */
    id: "impressions_by_hour",
    label: "Impressões por hora",
    description:
      "Distribuição das impressões por hora do dia, no fuso de quem viu o anúncio.",
    channels: PAID_CHANNELS,
    format: "integer",
    polarity: "neutral",
    additive: false,
    source: "paid",
    availability: "available",
    grain: "snapshot",
    shape: "distribution",
  },
  {
    /**
     * The same dayparts read as money instead of delivery.
     *
     * Rides the one request `impressions_by_hour` already pays for, so the
     * second card costs nothing. It answers a different question — "when is the
     * budget going out" rather than "when are people seeing it" — and the two
     * diverge whenever the auction is more expensive at some hours than others,
     * which is the finding that makes dayparting worth doing at all.
     */
    id: "spend_by_hour",
    label: "Investimento por hora",
    description:
      "Distribuição do valor investido por hora do dia, no fuso de quem viu o anúncio.",
    channels: PAID_CHANNELS,
    format: "currency",
    polarity: "neutral",
    additive: false,
    source: "paid",
    availability: "available",
    grain: "snapshot",
    shape: "distribution",
  },
  {
    id: "followers_gender",
    label: "Seguidores por gênero",
    description: "Distribuição dos seguidores por gênero.",
    // Instagram only. Meta retired the Page equivalents
    // (`page_fans_gender_age`, `page_fans_city`, `page_fans_country`) across
    // the whole API — they answer with the same error an invented metric name
    // gets, on v26, v23 and v20 alike. This is not a gap we can close.
    channels: ["instagram"],
    format: "integer",
    polarity: "neutral",
    additive: false,
    source: "organic",
    availability: "available",
    grain: "snapshot",
    shape: "distribution",
  },
  {
    id: "followers_city",
    label: "Cidades com mais seguidores",
    description:
      "Onde os seguidores estão. A Meta suprime cidades com poucos seguidores, então a soma da tabela é menor que o total de seguidores.",
    /**
     * Both surfaces, since 2026-09-25.
     *
     * It was Instagram-only because `page_fans_city` had been retired and this
     * project read that as the end of Page geography. It was not:
     * `page_follows_city` replaces it and answers — but only with
     * `period=day`, returning an empty array and no error under the `lifetime`
     * period the old metric used. Age and gender have no such replacement, so
     * `followers_gender` stays Instagram-only.
     */
    channels: ["instagram", "facebook"],
    format: "integer",
    polarity: "neutral",
    additive: false,
    source: "organic",
    availability: "available",
    grain: "snapshot",
    shape: "ranking",
  },
  {
    id: "organic_audience_age_gender",
    label: "Audiência por idade e gênero",
    description:
      "Seus seguidores agrupados por faixa etária e gênero. O Instagram só informa o número atual de seguidores no momento em que o relatório é gerado, independentemente do período selecionado.",
    /**
     * Instagram only, and distinct from the paid `audience_age_gender`: that
     * one describes who the ads reached in the period, this one is who follows
     * the account today. Same dimension, different populations — showing either
     * under the other's label would answer a question nobody asked.
     */
    channels: INSTAGRAM_ONLY,
    format: "integer",
    polarity: "neutral",
    additive: false,
    source: "organic",
    availability: "available",
    grain: "snapshot",
    shape: "distribution",
  },
  {
    id: "best_weekday",
    label: "Melhor dia para postagem",
    description:
      "Em média, em qual dia seus seguidores estiveram mais ativos no Instagram nos últimos 30 dias. O Instagram só devolve 30 dias retroativos deste gráfico, independentemente do período analisado.",
    channels: INSTAGRAM_ONLY,
    format: "integer",
    polarity: "neutral",
    /**
     * The counts behind this are a stock: one follower online at 14h and 15h is
     * one person in two readings. Every figure shown is a mean, and a sum would
     * not be a number of people.
     */
    additive: false,
    source: "organic",
    availability: "available",
    grain: "snapshot",
    shape: "distribution",
  },
  /*
   * A different question from `best_weekday` above, which is why it is a
   * different metric rather than that one with another channel added.
   *
   * `best_weekday` asks when the audience is *online*, from Instagram's
   * follower-activity grid. This asks which weekday's *publications performed
   * best*, from the Page's own post views. An account can have its audience
   * most online on Sunday and its best-performing posts on Wednesday, and
   * collapsing the two would answer neither question reliably.
   */
  {
    id: "post_weekday_performance",
    label: "Melhor dia para postagem",
    description:
      "Média de visualizações por publicação em cada dia da semana. Nenhum dia é apontado enquanto houver poucas publicações no período — a média de uma ou duas não distingue o dia do post.",
    channels: FACEBOOK_ONLY,
    format: "integer",
    polarity: "neutral",
    /** Every figure is a mean per publication; a sum would not be one. */
    additive: false,
    source: "organic",
    availability: "available",
    grain: "organic_period",
    shape: "distribution",
  },
  {
    id: "best_hour",
    label: "Melhor horário para postagens",
    description:
      "Em média, em qual horário seus seguidores estiveram mais ativos no Instagram nos últimos 30 dias. O Instagram informa estes dados no fuso do Pacífico; o gráfico já converte para o fuso do perfil.",
    channels: INSTAGRAM_ONLY,
    format: "integer",
    polarity: "neutral",
    additive: false,
    source: "organic",
    availability: "available",
    grain: "snapshot",
    shape: "distribution",
  },
  {
    id: "reach_by_device",
    label: "Alcance por dispositivo",
    description: "Pessoas alcançadas em cada tipo de dispositivo.",
    channels: PAID_CHANNELS,
    format: "integer",
    polarity: "neutral",
    additive: false,
    source: "paid",
    availability: "available",
    grain: "paid_period",
    shape: "distribution",
  },
  {
    id: "spend_by_publisher",
    label: "Valor gasto por rede",
    description: "Como o investimento se dividiu entre Facebook e Instagram.",
    channels: PAID_CHANNELS,
    format: "currency",
    polarity: "neutral",
    additive: true,
    source: "paid",
    availability: "available",
    grain: "paid_period",
    shape: "distribution",
  },
  {
    id: "reach_by_publisher",
    label: "Alcance por rede",
    description:
      "Pessoas alcançadas em cada rede. Alcance não é somável entre redes nem entre dias — a mesma pessoa pode ter sido alcançada nas duas, então as fatias não formam um total.",
    channels: PAID_CHANNELS,
    format: "integer",
    polarity: "neutral",
    // The ingest has been storing this since the breakdown slice shipped; the
    // flag was left at `not_integrated` and never revisited. Production holds
    // real figures for both networks, so the card was hiding data it had.
    availability: "available",
    additive: false,
    source: "paid",
    grain: "paid_period",
    shape: "distribution",
  },
  {
    id: "clicks_by_publisher",
    label: "Cliques por rede",
    description: "Como os cliques se dividiram entre Facebook e Instagram.",
    channels: PAID_CHANNELS,
    format: "integer",
    polarity: "neutral",
    additive: true,
    source: "paid",
    availability: "available",
    grain: "paid_period",
    shape: "distribution",
  },
  {
    id: "impressions_by_publisher",
    label: "Impressões por rede",
    description: "Como as exibições se dividiram entre Facebook e Instagram.",
    channels: PAID_CHANNELS,
    format: "integer",
    polarity: "neutral",
    additive: true,
    source: "paid",
    availability: "available",
    grain: "paid_period",
    shape: "distribution",
  },
  {
    id: "thruplays",
    label: "ThruPlays",
    description:
      "Reproduções até o fim ou por pelo menos 15 segundos. Diferente de “Visualizações de vídeo”, que conta 3 segundos — o mesmo anúncio costuma ter cerca de 5x mais visualizações do que ThruPlays.",
    channels: PAID_CHANNELS,
    format: "integer",
    polarity: "higher_is_better",
    additive: true,
    source: "paid",
    availability: "available",
    grain: "paid_period",
  },
  {
    id: "video_avg_watch_seconds",
    label: "Tempo médio de exibição",
    description:
      "Quantos segundos, em média, cada visualização durou. É uma média do período inteiro, ponderada por visualizações — não a média das médias diárias.",
    channels: PAID_CHANNELS,
    format: "ratio",
    polarity: "higher_is_better",
    // A mean. Summing it is meaningless and averaging it again is wrong unless
    // every part had the same view count — the API already returns the
    // period's weighted figure.
    additive: false,
    source: "paid",
    availability: "available",
    grain: "paid_period",
  },
  {
    id: "boosted_publications",
    label: "Boosts",
    description: "Publicações impulsionadas pelo Lyra no período.",
    // Read from the ad account's counts (`readPaid`), so it belongs to the
    // Meta Ads block. It used to be offered on all three and was sitting on
    // every Facebook and Instagram block, reading the ad account there.
    channels: PAID_CHANNELS,
    format: "integer",
    polarity: "neutral",
    additive: true,
    source: "boost",
    availability: "available",
    grain: "event_window",
  },
  {
    id: "total_interactions",
    label: "Interações totais",
    description:
      "Curtidas, comentários, compartilhamentos e salvamentos somados, contados no dia em que aconteceram — inclusive em publicações antigas.",
    channels: ["instagram"],
    format: "integer",
    polarity: "higher_is_better",
    additive: true,
    source: "organic",
    availability: "available",
    grain: "organic_period",
  },
  {
    id: "accounts_engaged",
    label: "Contas que interagiram",
    description:
      "Quantas contas diferentes interagiram. A Meta mede por dia, então só aparece quando o período é de um único dia — somar os dias contaria a mesma pessoa várias vezes.",
    channels: ["instagram"],
    format: "integer",
    polarity: "higher_is_better",
    // Same rule as reach: a per-day distinct count has no additive period
    // equivalent, and the API returns null rather than a sum.
    additive: false,
    source: "organic",
    availability: "available",
    grain: "organic_period",
  },
  {
    id: "organic_likes",
    label: "Curtidas",
    description: "Curtidas recebidas no período, somando todas as publicações.",
    channels: ["instagram"],
    format: "integer",
    polarity: "higher_is_better",
    additive: true,
    source: "organic",
    availability: "available",
    grain: "organic_period",
  },
  {
    id: "organic_comments",
    label: "Comentários",
    description: "Comentários recebidos no período.",
    channels: ["instagram"],
    format: "integer",
    polarity: "higher_is_better",
    additive: true,
    source: "organic",
    availability: "available",
    grain: "organic_period",
  },
  {
    id: "organic_shares",
    label: "Compartilhamentos",
    description: "Compartilhamentos das publicações no período.",
    channels: ["instagram"],
    format: "integer",
    polarity: "higher_is_better",
    additive: true,
    source: "organic",
    availability: "available",
    grain: "organic_period",
  },
  {
    id: "organic_saves",
    label: "Salvamentos",
    description: "Quantas vezes as publicações foram salvas no período.",
    channels: ["instagram"],
    format: "integer",
    polarity: "higher_is_better",
    additive: true,
    source: "organic",
    availability: "available",
    grain: "organic_period",
  },
  {
    id: "organic_replies",
    label: "Respostas",
    description: "Respostas recebidas em stories e mensagens no período.",
    channels: ["instagram"],
    format: "integer",
    polarity: "higher_is_better",
    additive: true,
    source: "organic",
    availability: "available",
    grain: "organic_period",
  },
  {
    id: "followers_delta",
    label: "Variação de seguidores",
    description:
      "Seguidores ganhos menos perdidos. Fica negativo quando o perfil perde mais do que ganha — e esse é o número que importa, não só os ganhos.",
    channels: META_SURFACES,
    format: "integer",
    polarity: "higher_is_better",
    additive: true,
    source: "organic",
    availability: "available",
    grain: "organic_period",
  },
  {
    id: "campaigns_count",
    label: "Campanhas",
    description:
      "Campanhas que tiveram veiculação no período — não o total da conta, que inclui tudo o que já existiu.",
    channels: PAID_CHANNELS,
    format: "integer",
    polarity: "neutral",
    additive: false,
    source: "paid",
    availability: "available",
    grain: "paid_period",
  },
  {
    id: "ads_count",
    label: "Anúncios",
    description:
      "Anúncios que tiveram veiculação no período — não o total da conta, que inclui tudo o que já existiu.",
    channels: PAID_CHANNELS,
    format: "integer",
    polarity: "neutral",
    additive: false,
    source: "paid",
    // Withheld until Fatia C, which turned on `entity_level = 'ad'` ingestion.
    // The query and the column were always right; there was simply nothing at
    // that level to count, and a zero would have read as "no ads ran". There
    // is now: production holds ad-level facts and the count returns them.
    availability: "available",
    grain: "paid_period",
  },

  // ── Resumo: uma pergunta, todos os canais ───────────────────────────────
  //
  // Every metric here adds an ad-account figure to the pages' own. They are
  // `summary`-only: placing one on a channel dashboard would be a number that
  // spans networks the tab does not claim to show.
  {
    id: "summary_spend",
    label: "Valor investido",
    description:
      "Total investido em anúncios no período. Só o Meta Ads gera investimento hoje, então este número é o da conta de anúncios.",
    channels: SUMMARY_ONLY,
    format: "currency",
    polarity: "neutral",
    additive: true,
    source: "summary",
    availability: "available",
    grain: "paid_period",
  },
  {
    id: "summary_reach",
    label: "Alcance total das contas",
    description:
      "Soma do alcance de cada canal. Quem viu um anúncio e um post é contado em cada um, então o número é um teto, não uma medida de pessoas únicas.",
    channels: SUMMARY_ONLY,
    format: "integer",
    // Non-additive and summed anyway, by decision: the operator asked for one
    // figure and accepted the overlap. The `detail` line on the card says so
    // every time it renders — see `analyticsCardValues`. Marked false so that
    // nothing else in the product treats it as safe to add further.
    additive: false,
    polarity: "higher_is_better",
    source: "summary",
    availability: "available",
    grain: "paid_period",
  },
  {
    id: "summary_impressions",
    label: "Impressões",
    description:
      "Quantas vezes o conteúdo foi exibido, somando anúncios e publicações. A mesma pessoa pode contar várias vezes — aqui isso é esperado.",
    channels: SUMMARY_ONLY,
    format: "integer",
    polarity: "higher_is_better",
    additive: true,
    source: "summary",
    availability: "available",
    grain: "paid_period",
  },
  {
    id: "summary_clicks",
    label: "Cliques",
    description: "Todos os cliques registrados no período, em todos os canais.",
    channels: SUMMARY_ONLY,
    format: "integer",
    polarity: "higher_is_better",
    additive: true,
    source: "summary",
    availability: "available",
    grain: "paid_period",
  },
  {
    id: "summary_ads",
    label: "Número de anúncios",
    description:
      "Anúncios que tiveram veiculação no período — não o total da conta, que inclui tudo o que já existiu.",
    channels: SUMMARY_ONLY,
    format: "integer",
    polarity: "neutral",
    additive: false,
    source: "summary",
    availability: "available",
    grain: "paid_period",
  },
  {
    id: "summary_publications",
    label: "Número de postagens",
    description: "Publicações feitas no período, somando Instagram e Facebook.",
    channels: SUMMARY_ONLY,
    format: "integer",
    polarity: "neutral",
    additive: true,
    source: "summary",
    availability: "available",
    grain: "organic_period",
  },
  {
    id: "summary_new_followers",
    label: "Novos seguidores",
    description:
      "Seguidores ganhos no período, somando as contas. É o ganho bruto: quem deixou de seguir não é descontado aqui.",
    channels: SUMMARY_ONLY,
    format: "integer",
    polarity: "higher_is_better",
    additive: true,
    source: "summary",
    availability: "available",
    grain: "organic_period",
  },
  {
    id: "summary_engagement",
    label: "Engajamento das postagens",
    description:
      "Interações com as publicações no período — curtidas, comentários, compartilhamentos e salvamentos, somando as contas.",
    channels: SUMMARY_ONLY,
    format: "integer",
    polarity: "higher_is_better",
    additive: true,
    source: "summary",
    availability: "available",
    grain: "organic_period",
  },
];

/**
 * Metrics with no column behind them, computed from two that have one.
 *
 * Kept as data rather than as a branch in the card renderer so that "where does
 * this number come from" has one answer per metric. A derived metric is
 * available only when both of its inputs are.
 */
export const DERIVED_METRICS: Partial<
  Record<MetricId, { from: [MetricId, MetricId]; op: "subtract" }>
> = {
  followers_delta: {
    from: ["followers_gained", "followers_lost"],
    op: "subtract",
  },
};

const BY_ID = new Map(
  SOCIAL_METRIC_CATALOG.map((metric) => [metric.id, metric] as const),
);

export function findMetric(id: MetricId): MetricDefinition | null {
  return BY_ID.get(id) ?? null;
}

export function isMetricId(
  value: string | null | undefined,
): value is MetricId {
  return !!value && BY_ID.has(value as MetricId);
}

export function metricsForChannel(channel: ChannelId): MetricDefinition[] {
  return SOCIAL_METRIC_CATALOG.filter((metric) =>
    metric.channels.includes(channel),
  );
}

/**
 * Whether a rate between two metrics is a real number or a coincidence.
 *
 * A funnel step's conversion rate is `value / previousValue`. That quotient only
 * means something when both readings count the same cohort over the same window
 * — otherwise it is two unrelated numbers divided by each other, which is the
 * failure `project_social_i3_3_temporal_facts` documents: rates that looked fine
 * and described nothing, because the denominator's cohort had opened before the
 * window and the numerator's had not.
 *
 * `paid_period` and `paid_period_deduplicated` are the one pair that crosses:
 * both are the selected period on the same account, and the difference between
 * them is only how the duplicates inside it were removed. Everything else —
 * organic against paid, a lifetime snapshot against a period, an event window
 * against an insight — is incomparable, and the funnel shows the absolute values
 * with no rate rather than a number it cannot defend.
 */
const COMPARABLE_GRAINS: Record<MetricGrain, MetricGrain[]> = {
  paid_period: ["paid_period", "paid_period_deduplicated"],
  paid_period_deduplicated: ["paid_period_deduplicated", "paid_period"],
  organic_period: ["organic_period"],
  snapshot: [],
  event_window: [],
};

export function grainsAreComparable(a: MetricGrain, b: MetricGrain): boolean {
  return COMPARABLE_GRAINS[a].includes(b);
}

/**
 * The sentence a card shows in place of a number.
 *
 * Null when the metric is readable, which is the caller's signal to render the
 * value. Phrased as a state of the collection rather than of the account: "não
 * coletamos isso ainda" is recoverable and true, while "sem dados" reads as a
 * statement about the client's performance.
 */
export function describeUnavailability(
  metric: MetricDefinition,
): string | null {
  switch (metric.availability) {
    case "available":
      return null;
    case "requires_breakdown_ingest":
      return "Esta métrica ainda não está sendo coletada para este canal.";
    case "not_integrated":
      return "Métrica indisponível para este canal.";
  }
}
