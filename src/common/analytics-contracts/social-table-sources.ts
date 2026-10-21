/**
 * What a table card can be pointed at, and which columns each source offers.
 *
 * A table card stores `source` plus an ordered list of `{ id, visible }`
 * columns (§4.1). That list is only meaningful against a definition of what the
 * ids mean, and this module is it: the label a column shows, how its value is
 * written, and whether the API will sort by it.
 *
 * ## Why sortability is a property of the column and not of the table
 *
 * The server is the authority on ordering — both endpoints take a closed set of
 * sort keys and reject anything else. A column outside that set can still be
 * displayed (an ad set's optimisation goal is worth seeing), but offering to
 * sort by it would produce a request the API refuses. So the column carries the
 * API's key when one exists and null when it does not, and the header only
 * becomes a button in the first case.
 *
 * ## Why the row is read through an accessor rather than by index
 *
 * The two sources return different shapes. Reading `row[column.id]` would work
 * until a column id stopped matching a field name — which is already true for
 * the identity column, where the id is `name` but the cell renders the name,
 * the objective and the status badges together.
 */

import type {
  SocialAdAdRow,
  SocialAdAdSetRow,
  SocialAdAdSetSort,
  SocialAdAdSort,
  SocialAdCampaignRow,
  SocialAdCampaignSort,
  SocialAdActionTypeTotal,
  SocialAdConversionTotal,
  SocialOrganicPostSurface,
  SocialOrganicTopPost,
  SocialOrganicFacebookReel,
  SocialOrganicFacebookReelSort,
  SocialOrganicTopPostSort,
} from "./social-analytics.types";
import type { ChannelId } from "./social-channels";

export const TABLE_SOURCE_IDS = [
  "paid_hierarchy",
  "campaigns",
  "ad_sets",
  "ads",
  "conversions",
  "action_types",
  "organic_posts",
  "organic_reels",
  "organic_stories",
  "facebook_posts",
  "facebook_reels",
  "channel_interactions",
  "post_interactions",
  "reel_interactions",
  "story_interactions",
  "ad_interactions",
] as const;

export type TableSourceId = (typeof TABLE_SOURCE_IDS)[number];

/**
 * Which endpoint a source reads, and therefore which row shape it returns.
 *
 * The families are genuinely different and the discriminator is what keeps them
 * from being confused for each other. A paid row is a period aggregate of an
 * entity that is still delivering — spend in the window, additive across rows.
 * An organic row is one post's **lifetime** counters as of the last time Meta
 * was asked, which is why that table shows no totals: adding two posts' reach
 * counts anyone who saw both of them twice.
 *
 * `stories` is a third kind rather than an organic source with `surface:
 * "story"`, because a story is not in the posts table and never will be: it
 * lives on a separate edge for 24 hours and then cannot be read by anyone. Its
 * rows come from a capture, it has retention counters no other surface has, and
 * it renders as a creative beside its figures rather than as a table row. A
 * source that only differed by a filter would have quietly returned nothing.
 */
export type TableSourceKind =
  | "paid"
  | "organic"
  | "stories"
  | "facebook_reels"
  /**
   * Conversion events read from the overview's `conversions` list.
   *
   * Its own kind rather than a `paid` source, and the reason is the row: every
   * other paid row is one *entity* — a campaign, an ad set — measured over the
   * period. A row here is one *event type* measured over the same period, so it
   * has no name to sort by, no status, and no share of spend that belongs to it
   * alone. It also comes from the overview response the dashboard already
   * loaded rather than from an endpoint of its own, so a card of this kind
   * costs no extra request.
   */
  | "conversions"
  /**
   * Ranked action types, also from the overview.
   *
   * A separate kind from `conversions` although both are event rows from the
   * same response, because the rows answer different questions and carry
   * different fields. A conversion row is a catalogued commerce event with
   * money, a cost and a ROAS; an action-type row is whatever Meta reported,
   * with a count and the alias names it absorbed — no value, no ROAS, and a
   * type Meta named rather than an id this catalog chose.
   *
   * Sharing a kind would mean one renderer switching on which fields happen to
   * be present, which is how the paid branches came to assume "not a
   * publication means entity" and needed unpicking.
   */
  | "action_types"
  /**
   * One row of totals — views, likes, comments, shares, saves — for a profile,
   * its posts or its reels.
   *
   * Not a ranking: there is nothing to sort, page or limit, and the figures
   * come from the organic overview the dashboard already loaded, so the card
   * costs no request. Drawn by its own component, like stories.
   */
  | "interactions"
  /** The same row for the ad account, from the paid overview's actions. */
  | "ad_interactions";

/**
 * Whether a kind reads from the ad account rather than from a connected page.
 *
 * Exhaustive over `TableSourceKind` on purpose, and the `switch` is the point:
 * the source picker used to group its options by naming the kinds it wanted on
 * each side, and the two it did not name — `stories` and `facebook_reels` —
 * silently belonged to neither group. Both had a working card and a working
 * endpoint and simply could not be selected. A predicate that must return a
 * boolean for every member turns that into a compile error at the moment a
 * kind is added, which is the only moment anyone would still remember this.
 *
 * It answers "paid?" rather than "which group?" because the split really is
 * binary — money spent on an ad account, or a page's own reach — and a function
 * returning a group label would invite a third group nobody renders.
 */
export function isPaidSourceKind(kind: TableSourceKind): boolean {
  switch (kind) {
    case "paid":
    case "conversions":
    case "action_types":
    case "ad_interactions":
      return true;
    case "organic":
    case "stories":
    case "facebook_reels":
    case "interactions":
      return false;
  }
}

/** The API sort keys, which are the same closed set for all three paid sources. */
export type TableSortKey = Extract<Extract<SocialAdCampaignSort, SocialAdAdSetSort>, SocialAdAdSort>;

export type TableCellFormat =
  | "text"
  | "currency"
  | "integer"
  | "percent"
  | "ratio"
  /** An ISO instant written as a short date. Only the post rankings use it. */
  | "date"
  /** Milliseconds, written as seconds. Reels' watch times. */
  | "duration"
  /**
   * Meta's per-second retention map, drawn as a curve.
   *
   * A chart rather than a number because that is what the value is: a line
   * per reel showing how many viewers were still watching at each second. No
   * single figure summarises it — "average retention" would flatten the drop
   * at second 4 that is the whole reason to look.
   */
  | "retention"
  /** Hundredths of a percent, written as a percentage. Reels' skip rate. */
  | "basis_points"
  /**
   * An ad's creative, drawn as a thumbnail beside its name.
   *
   * A format rather than a text column because the stored value is an id and
   * the cell is a picture: Meta's image links are signed and expire in about
   * five days, so nothing durable holds a URL and the image is fetched per row
   * at render time. Printing the id would be printing an internal identifier,
   * which this product does not do.
   */
  | "creative";

export type TableColumnDefinition = {
  id: string;
  label: string;
  format: TableCellFormat;
  /**
   * The API's sort key, or null when the endpoint will not order by it.
   *
   * The families have separate closed sets, and a key is only ever sent to the
   * endpoint of the source that declared it — a source cannot mix them, because
   * a column belongs to exactly one source's list.
   */
  sortKey: TableSortKey | SocialOrganicTopPostSort | SocialOrganicFacebookReelSort | null;
  /** Right-aligned in the table, as every numeric column in this module is. */
  numeric: boolean;
};

export type TableSourceDefinition = {
  id: TableSourceId;
  label: string;
  /** Shown in the drawer under the source picker. */
  description: string;
  kind: TableSourceKind;
  /**
   * The channels whose sections may hold this table.
   *
   * Declared per source rather than derived from `kind`, because `kind` cannot
   * tell the two networks apart: `organic_posts` and `facebook_posts` are both
   * `organic` and belong to different dashboards entirely. It mirrors
   * `channels` on a metric definition, so a section filters tables and metrics
   * by the same question — which is the point, since both now come from one
   * drawer.
   *
   * A Reels table on a Facebook dashboard is not merely untidy: the sources
   * read different endpoints, and the card would be empty forever while looking
   * like a broken pipeline.
   */
  channels: ChannelId[];
  /**
   * For an organic source, the surface its ranking is narrowed to.
   *
   * Three sources rather than one source with a filter, because on a dashboard
   * they are three different cards an operator places side by side — and the
   * card's stored `source` is the whole of its identity, so a surface kept
   * anywhere else would not survive being saved.
   */
  surface: SocialOrganicPostSurface | null;
  columns: TableColumnDefinition[];
  /** The columns a freshly created table card opens with, in order. */
  defaultColumnIds: string[];
  defaultSort: { columnId: string; direction: "asc" | "desc" };
};

/**
 * Columns both sources share.
 *
 * Built by a function rather than shared by reference so that a source can
 * append its own without the array of the other growing with it.
 */
function sharedMetricColumns(): TableColumnDefinition[] {
  return [
    { id: "spend", label: "Investimento", format: "currency", sortKey: "spend", numeric: true },
    { id: "impressions", label: "Impressões", format: "integer", sortKey: "impressions", numeric: true },
    { id: "clicks", label: "Cliques", format: "integer", sortKey: "clicks", numeric: true },
    { id: "linkClicks", label: "Cliques no link", format: "integer", sortKey: null, numeric: true },
    { id: "leads", label: "Leads", format: "integer", sortKey: "leads", numeric: true },
    { id: "conversions", label: "Resultados", format: "integer", sortKey: "conversions", numeric: true },
    { id: "conversionValue", label: "Valor de conversão", format: "currency", sortKey: null, numeric: true },
    { id: "videoViews", label: "Visualizações de vídeo", format: "integer", sortKey: null, numeric: true },
    { id: "ctr", label: "CTR", format: "percent", sortKey: "ctr", numeric: true },
    { id: "cpc", label: "CPC", format: "currency", sortKey: "cpc", numeric: true },
    { id: "cpl", label: "CPL", format: "currency", sortKey: "cpl", numeric: true },
    { id: "roas", label: "ROAS", format: "ratio", sortKey: "roas", numeric: true },
  ];
}

/**
 * The columns every post ranking shares.
 *
 * All lifetime totals — cumulative since the post was published, not the
 * period's share of them — which is why none of them is summed anywhere and why
 * the identity column carries the publish date rather than a date range.
 */
function postColumns(): TableColumnDefinition[] {
  return [
    { id: "name", label: "Publicação", format: "text", sortKey: null, numeric: false },
    { id: "reach", label: "Alcance", format: "integer", sortKey: "reach", numeric: true },
    { id: "impressions", label: "Impressões", format: "integer", sortKey: "impressions", numeric: true },
    { id: "totalInteractions", label: "Interações", format: "integer", sortKey: "totalInteractions", numeric: true },
    { id: "likes", label: "Curtidas", format: "integer", sortKey: "likes", numeric: true },
    { id: "comments", label: "Comentários", format: "integer", sortKey: "comments", numeric: true },
    { id: "saves", label: "Salvamentos", format: "integer", sortKey: "saves", numeric: true },
    { id: "shares", label: "Compartilhamentos", format: "integer", sortKey: "shares", numeric: true },
    { id: "profileVisits", label: "Visitas ao perfil", format: "integer", sortKey: "profileVisits", numeric: true },
    { id: "follows", label: "Novos seguidores", format: "integer", sortKey: "follows", numeric: true },
    { id: "publishedAt", label: "Publicado em", format: "date", sortKey: "publishedAt", numeric: false },
  ];
}

/**
 * The columns a reel ranking offers.
 *
 * Not `postColumns()` minus two, because the difference is not cosmetic: Meta
 * **refuses** `profile_visits` and `follows` for a reel, and refuses the whole
 * insights request along with them, so those columns can never hold anything
 * for this source. Offering them would be a column of em dashes that reads as
 * missing data rather than as a metric the surface does not report.
 *
 * In their place are the four a reel does report and a feed post does not:
 * watch time, skip rate and reposts.
 */
function reelColumns(): TableColumnDefinition[] {
  return [
    { id: "name", label: "Reel", format: "text", sortKey: null, numeric: false },
    { id: "reach", label: "Alcance", format: "integer", sortKey: "reach", numeric: true },
    { id: "impressions", label: "Visualizações", format: "integer", sortKey: "impressions", numeric: true },
    { id: "totalInteractions", label: "Interações", format: "integer", sortKey: "totalInteractions", numeric: true },
    { id: "likes", label: "Curtidas", format: "integer", sortKey: "likes", numeric: true },
    { id: "comments", label: "Comentários", format: "integer", sortKey: "comments", numeric: true },
    { id: "saves", label: "Salvamentos", format: "integer", sortKey: "saves", numeric: true },
    { id: "shares", label: "Compartilhamentos", format: "integer", sortKey: "shares", numeric: true },
    // Reel-only. No sort key: the endpoint's closed set does not include them,
    // and a header that refuses the request is worse than one that is not a
    // button.
    { id: "reelsAvgWatchTimeMs", label: "Tempo médio", format: "duration", sortKey: null, numeric: true },
    { id: "reelsTotalWatchTimeMs", label: "Tempo total", format: "duration", sortKey: null, numeric: true },
    { id: "reelsSkipRateBp", label: "Taxa de pulo", format: "basis_points", sortKey: null, numeric: true },
    { id: "reposts", label: "Reposts", format: "integer", sortKey: null, numeric: true },
    { id: "publishedAt", label: "Publicado em", format: "date", sortKey: "publishedAt", numeric: false },
  ];
}

/**
 * The columns a Facebook Page post ranking offers.
 *
 * Not `postColumns()`: almost nothing lines up. A Page post has no reach at all
 * — Meta retired every unique-audience metric a Page reported — and no saves,
 * no profile visits and no new-follower attribution. What it has instead is the
 * reaction split by emoji and a real organic/paid view split, neither of which
 * exists on the Instagram side.
 *
 * The six reaction columns are the "tabela de reações" as columns rather than a
 * table of its own, so an operator can sort the ranking by any one of them.
 */
function facebookPostColumns(): TableColumnDefinition[] {
  return [
    { id: "name", label: "Publicação", format: "text", sortKey: null, numeric: false },
    { id: "mediaType", label: "Tipo", format: "text", sortKey: null, numeric: false },
    { id: "impressions", label: "Visualizações", format: "integer", sortKey: "impressions", numeric: true },
    { id: "viewsOrganic", label: "Visualizações orgânicas", format: "integer", sortKey: null, numeric: true },
    { id: "viewsPaid", label: "Visualizações pagas", format: "integer", sortKey: null, numeric: true },
    { id: "reactionsTotal", label: "Total de reações", format: "integer", sortKey: "reactionsTotal", numeric: true },
    // The emoji split. No sort keys: the endpoint orders by the total, and a
    // header that produces a request it refuses is worse than a plain label.
    { id: "reactionsLike", label: "Curtir", format: "integer", sortKey: null, numeric: true },
    { id: "reactionsLove", label: "Amei", format: "integer", sortKey: null, numeric: true },
    { id: "reactionsHaha", label: "Haha", format: "integer", sortKey: null, numeric: true },
    { id: "reactionsWow", label: "Uau", format: "integer", sortKey: null, numeric: true },
    { id: "reactionsSorry", label: "Triste", format: "integer", sortKey: null, numeric: true },
    { id: "reactionsAnger", label: "Grr", format: "integer", sortKey: null, numeric: true },
    { id: "comments", label: "Comentários", format: "integer", sortKey: "comments", numeric: true },
    { id: "shares", label: "Compartilhamentos", format: "integer", sortKey: "shares", numeric: true },
    { id: "publishedAt", label: "Criado em", format: "date", sortKey: "publishedAt", numeric: false },
  ];
}

/**
 * The columns a Facebook reel ranking offers.
 *
 * A different vocabulary again, from a different Graph edge: plays, replays and
 * unique viewers where an Instagram reel reports views, reach and saves. A play
 * counts a start and a view counts a threshold, so these are not the same
 * numbers under other names.
 *
 * `uniqueViewers` is the only unique-audience figure left anywhere on the
 * Facebook side, which is why it leads.
 */
function facebookReelColumns(): TableColumnDefinition[] {
  return [
    { id: "name", label: "Reel", format: "text", sortKey: null, numeric: false },
    { id: "uniqueViewers", label: "Visualizadores", format: "integer", sortKey: "uniqueViewers", numeric: true },
    { id: "plays", label: "Visualizações", format: "integer", sortKey: "plays", numeric: true },
    { id: "replays", label: "Repetições", format: "integer", sortKey: null, numeric: true },
    { id: "totalWatchTimeMs", label: "Tempo total", format: "duration", sortKey: "totalWatchTimeMs", numeric: true },
    { id: "avgWatchTimeMs", label: "Tempo médio", format: "duration", sortKey: "avgWatchTimeMs", numeric: true },
    { id: "reactionsTotal", label: "Curtidas", format: "integer", sortKey: "reactionsTotal", numeric: true },
    { id: "comments", label: "Comentários", format: "integer", sortKey: "comments", numeric: true },
    { id: "shares", label: "Compartilhamentos", format: "integer", sortKey: "shares", numeric: true },
    { id: "newFollowers", label: "Novos seguidores", format: "integer", sortKey: null, numeric: true },
    // The curve, drawn in the cell. Not sortable and not numeric: it is a shape,
    // and there is no ordering of shapes an operator would mean by clicking.
    { id: "retentionGraph", label: "Retenção", format: "retention", sortKey: null, numeric: false },
    { id: "publishedAt", label: "Criado em", format: "date", sortKey: "publishedAt", numeric: false },
  ];
}

/**
 * Which dashboards each family of table belongs on.
 *
 * Deliberately the same three groupings the metric catalog uses, and named the
 * same way, because the drawer now asks one question of metrics and tables
 * alike. A paid table reads the ad account; an Instagram table reads the IG
 * media edge; a Facebook table reads the Page.
 */
const PAID_ONLY: ChannelId[] = ["meta_ads"];
const INSTAGRAM_ONLY: ChannelId[] = ["instagram"];
const FACEBOOK_ONLY: ChannelId[] = ["facebook"];
const ORGANIC_NETWORKS: ChannelId[] = ["instagram", "facebook"];

/**
 * The interactions row. The headers are icons (see
 * `AnalyticsInteractionsTable`); the labels are what a screen reader, the CSV
 * and the columns editor say.
 */
function interactionColumns(): TableColumnDefinition[] {
  return [
    { id: "views", label: "Visualizações", format: "integer", sortKey: null, numeric: true },
    { id: "likes", label: "Curtidas", format: "integer", sortKey: null, numeric: true },
    { id: "comments", label: "Comentários", format: "integer", sortKey: null, numeric: true },
    { id: "shares", label: "Compartilhamentos", format: "integer", sortKey: null, numeric: true },
    { id: "saves", label: "Salvamentos", format: "integer", sortKey: null, numeric: true },
  ];
}

const INTERACTION_COLUMN_IDS = ["views", "likes", "comments", "shares", "saves"];

export const TABLE_SOURCES: TableSourceDefinition[] = [
  {
    id: "paid_hierarchy",
    label: "Campanhas, conjuntos e anúncios",
    description: "Campanhas com conjuntos e anúncios expansíveis na coluna de nome.",
    kind: "paid",
    channels: PAID_ONLY,
    surface: null,
    columns: [
      { id: "name", label: "Campanha / Conjunto / Anúncio", format: "text", sortKey: "name", numeric: false },
      { id: "status", label: "Status", format: "text", sortKey: null, numeric: false },
      ...sharedMetricColumns(),
    ],
    defaultColumnIds: ["name", "status", "spend", "leads", "cpl", "ctr", "clicks"],
    defaultSort: { columnId: "spend", direction: "desc" },
  },
  {
    id: "campaigns",
    label: "Campanhas",
    description: "Desempenho por campanha da conta de anúncios selecionada.",
    kind: "paid",
    channels: PAID_ONLY,
    surface: null,
    columns: [
      { id: "name", label: "Campanha", format: "text", sortKey: "name", numeric: false },
      { id: "status", label: "Status", format: "text", sortKey: null, numeric: false },
      { id: "objective", label: "Objetivo", format: "text", sortKey: null, numeric: false },
      ...sharedMetricColumns(),
    ],
    defaultColumnIds: ["name", "status", "spend", "leads", "cpl", "ctr", "clicks"],
    defaultSort: { columnId: "spend", direction: "desc" },
  },
  {
    id: "ad_sets",
    label: "Conjuntos de anúncios",
    description: "Desempenho por conjunto. Traz a otimização e o destino, que existem só neste nível.",
    kind: "paid",
    channels: PAID_ONLY,
    surface: null,
    columns: [
      { id: "name", label: "Conjunto", format: "text", sortKey: "name", numeric: false },
      { id: "status", label: "Status", format: "text", sortKey: null, numeric: false },
      { id: "optimizationGoal", label: "Otimização", format: "text", sortKey: null, numeric: false },
      { id: "billingEvent", label: "Cobrança", format: "text", sortKey: null, numeric: false },
      { id: "destinationType", label: "Destino", format: "text", sortKey: null, numeric: false },
      ...sharedMetricColumns(),
    ],
    defaultColumnIds: ["name", "status", "spend", "leads", "cpl", "ctr", "clicks"],
    defaultSort: { columnId: "spend", direction: "desc" },
  },
  {
    /**
     * The finest grain, and the only one at which a creative can be judged.
     *
     * One ad set routinely runs several ads against one audience on one budget.
     * Dividing the ad set's spend between them would be an estimate presented
     * as a measurement, so the question "which creative worked" has no honest
     * answer above this level.
     *
     * Read-only, like every paid source here: these rows are Lyra's mirror of
     * what Meta reports, and a control that implied this table could pause an
     * ad would be implying a write scope the integration does not hold.
     */
    id: "ads",
    label: "Anúncios",
    description: "Desempenho por anúncio, com a miniatura do criativo. É o nível em que dá para comparar criativos entre si.",
    kind: "paid",
    channels: PAID_ONLY,
    surface: null,
    columns: [
      // The picture leads, because it is why this level is read at all. Not
      // sortable: there is no ordering of images an operator would mean.
      { id: "creativeId", label: "Criativo", format: "creative", sortKey: null, numeric: false },
      { id: "name", label: "Anúncio", format: "text", sortKey: "name", numeric: false },
      { id: "status", label: "Status", format: "text", sortKey: null, numeric: false },
      ...sharedMetricColumns(),
    ],
    defaultColumnIds: ["creativeId", "name", "status", "spend", "leads", "cpl", "ctr", "clicks"],
    defaultSort: { columnId: "spend", direction: "desc" },
  },
  {
    /**
     * Site, e-commerce, app and subscription events.
     *
     * Shows only what the account reported: an account with no pixel renders an
     * empty table rather than twenty rows of dashes. That emptiness is the
     * honest state and the card says so, because the alternative — listing
     * every catalogued event with a null — reads as "these are all zero" when
     * the truth is "this business does not measure these".
     */
    id: "conversions",
    label: "Conversões do site e do app",
    description: "Compras, carrinhos, cadastros e assinaturas atribuídos aos anúncios. Só aparecem os eventos que a conta reportou.",
    kind: "conversions",
    channels: PAID_ONLY,
    surface: null,
    columns: [
      { id: "label", label: "Evento", format: "text", sortKey: null, numeric: false },
      { id: "group", label: "Tipo", format: "text", sortKey: null, numeric: false },
      { id: "count", label: "Quantidade", format: "integer", sortKey: null, numeric: true },
      { id: "value", label: "Valor", format: "currency", sortKey: null, numeric: true },
      { id: "costPer", label: "Custo por evento", format: "currency", sortKey: null, numeric: true },
      { id: "roas", label: "ROAS", format: "ratio", sortKey: null, numeric: true },
    ],
    defaultColumnIds: ["label", "count", "value", "costPer", "roas"],
    // Sorted client-side by count: the list is at most twenty rows and comes
    // from a response already in hand, so there is no endpoint to order it.
    defaultSort: { columnId: "count", direction: "desc" },
  },
  {
    /**
     * Everything people did after seeing the ads, ranked.
     *
     * Unlike the conversions table above, this one has rows on every account:
     * engagements and video views arrive without a pixel. It is the table that
     * answers "what actually happened" rather than "how did the shop do".
     *
     * The alias collapse is the reason this is not simply the stored payload
     * sorted. Meta reports one event under several names — on the measured
     * account `page_engagement` and `post_engagement` both carried 1 036, and
     * four names each carried the same 4 leads. A raw ranking would spend half
     * its rows restating events and invite the reader to add them up.
     */
    id: "action_types",
    label: "Conversões e custo por conversão",
    description:
      "Tudo que as pessoas fizeram depois de ver os anúncios, com a quantidade e o custo de cada tipo. O custo usa o investimento do período inteiro em cada linha, então as linhas não somam o valor investido.",
    kind: "action_types",
    channels: PAID_ONLY,
    surface: null,
    columns: [
      { id: "label", label: "Tipo de conversão", format: "text", sortKey: null, numeric: false },
      { id: "count", label: "Conversões", format: "integer", sortKey: null, numeric: true },
      // Spend over the period divided by this event's count. On every row,
      // whatever the campaign was optimised for: the budget bought all of
      // these events together, so each row answers what one of them cost and
      // the column does not add up to the investment.
      { id: "costPer", label: "Custo por conversão", format: "currency", sortKey: null, numeric: true },
      { id: "absorbed", label: "Nomes agrupados", format: "text", sortKey: null, numeric: false },
    ],
    defaultColumnIds: ["label", "count", "costPer"],
    // Ten rows by default, which is what was asked for. The response carries
    // every type and the card takes its top N, so raising the limit needs no
    // request — see `rowLimit` on the card.
    defaultSort: { columnId: "count", direction: "desc" },
  },
  {
    id: "organic_posts",
    label: "Postagens em destaque",
    description: "Publicações do feed — imagem, vídeo e carrossel. Números acumulados desde a publicação, não somáveis entre linhas.",
    kind: "organic",
    channels: INSTAGRAM_ONLY,
    surface: "feed",
    columns: postColumns(),
    defaultColumnIds: ["name", "reach", "totalInteractions", "profileVisits", "follows", "publishedAt"],
    defaultSort: { columnId: "reach", direction: "desc" },
  },
  {
    id: "organic_reels",
    label: "Reels em destaque",
    description: "Só reels. Separados do feed porque um reel e uma foto no feed não disputam o mesmo alcance nem a mesma atenção.",
    kind: "organic",
    channels: INSTAGRAM_ONLY,
    surface: "reel",
    columns: reelColumns(),
    // Saves and shares are how a reel actually travels, so they lead here where
    // the feed table leads with profile visits — which a reel does not report
    // at all.
    defaultColumnIds: ["name", "impressions", "reach", "totalInteractions", "reelsAvgWatchTimeMs", "publishedAt"],
    defaultSort: { columnId: "reach", direction: "desc" },
  },
  {
    id: "organic_stories",
    label: "Stories em destaque",
    description:
      "Os stories de maior impacto no período, cada um com seu criativo e seus números. Um story só pode ser lido enquanto está no ar, então aparecem os que a coleta capturou.",
    kind: "stories",
    channels: INSTAGRAM_ONLY,
    surface: "story",
    // The panel renders a fixed pair of columns — creative on the left, figures
    // on the right — so there is no column list to configure and the drawer
    // shows none. See `AnalyticsStoriesCard`.
    columns: [],
    defaultColumnIds: [],
    defaultSort: { columnId: "views", direction: "desc" },
  },
  {
    id: "facebook_posts",
    label: "Postagens em destaque (Facebook)",
    description:
      "Publicações da Página, com as reações separadas por emoji e a divisão entre visualizações orgânicas e pagas. Uma Página não informa alcance: a Meta aposentou a métrica.",
    kind: "organic",
    // No surface filter: a Page post carries no `media_product_type`, so there
    // is nothing to narrow by — and the reels have a source of their own
    // because they are on a different edge entirely.
    channels: FACEBOOK_ONLY,
    surface: null,
    columns: facebookPostColumns(),
    defaultColumnIds: ["name", "mediaType", "impressions", "reactionsTotal", "comments", "shares", "publishedAt"],
    defaultSort: { columnId: "impressions", direction: "desc" },
  },
  {
    id: "facebook_reels",
    label: "Reels em destaque (Facebook)",
    description:
      "Reels da Página, com a curva de retenção de cada um. Vêm de outra origem na Meta, com métricas que não existem no feed nem no Instagram.",
    kind: "facebook_reels",
    channels: FACEBOOK_ONLY,
    surface: null,
    columns: facebookReelColumns(),
    defaultColumnIds: ["name", "uniqueViewers", "plays", "totalWatchTimeMs", "avgWatchTimeMs", "retentionGraph", "publishedAt"],
    defaultSort: { columnId: "plays", direction: "desc" },
  },
  {
    id: "channel_interactions",
    label: "Interações do perfil",
    description:
      "Visualizações, curtidas, comentários, compartilhamentos e salvamentos do perfil no período. No Facebook, curtidas são as reações das postagens e reels publicados no período.",
    kind: "interactions",
    channels: ORGANIC_NETWORKS,
    surface: null,
    columns: interactionColumns(),
    defaultColumnIds: INTERACTION_COLUMN_IDS,
    defaultSort: { columnId: "views", direction: "desc" },
  },
  {
    id: "post_interactions",
    label: "Interações das postagens",
    description: "Soma das postagens publicadas no período, com os números acumulados de cada uma desde a publicação.",
    kind: "interactions",
    channels: ORGANIC_NETWORKS,
    surface: null,
    columns: interactionColumns(),
    defaultColumnIds: INTERACTION_COLUMN_IDS,
    defaultSort: { columnId: "views", direction: "desc" },
  },
  {
    id: "reel_interactions",
    label: "Interações dos reels",
    description:
      "Soma dos reels publicados no período, com os números acumulados de cada um desde a publicação. No Facebook, visualizações são as reproduções.",
    kind: "interactions",
    channels: ORGANIC_NETWORKS,
    surface: null,
    columns: interactionColumns(),
    defaultColumnIds: INTERACTION_COLUMN_IDS,
    defaultSort: { columnId: "views", direction: "desc" },
  },
  {
    id: "story_interactions",
    label: "Interações dos stories",
    description:
      "Visualizações, respostas e compartilhamentos dos stories no período. O Instagram não informa curtidas nem salvamentos de stories; as respostas ocupam o lugar dos comentários.",
    kind: "interactions",
    channels: INSTAGRAM_ONLY,
    surface: null,
    columns: interactionColumns(),
    defaultColumnIds: INTERACTION_COLUMN_IDS,
    defaultSort: { columnId: "views", direction: "desc" },
  },
  {
    id: "ad_interactions",
    label: "Interações dos anúncios",
    description:
      "Impressões dos anúncios e o que as pessoas fizeram nas publicações anunciadas: reações, comentários, compartilhamentos e salvamentos.",
    kind: "ad_interactions",
    channels: PAID_ONLY,
    surface: null,
    columns: interactionColumns(),
    defaultColumnIds: INTERACTION_COLUMN_IDS,
    defaultSort: { columnId: "views", direction: "desc" },
  },
];

const SOURCES_BY_ID = new Map(TABLE_SOURCES.map((source) => [source.id, source] as const));

export function isTableSourceId(value: unknown): value is TableSourceId {
  return typeof value === "string" && (TABLE_SOURCE_IDS as readonly string[]).includes(value);
}

/**
 * The definition for a stored `source`.
 *
 * Falls back to campaigns rather than returning null: a card whose source no
 * longer exists is still a table the operator built, and showing the legacy
 * source keeps it editable — where a null would have to render an error state
 * with no way out of it.
 */
export function findTableSource(id: string): TableSourceDefinition {
  return SOURCES_BY_ID.get(id as TableSourceId) ?? SOURCES_BY_ID.get("campaigns")!;
}

/**
 * The tables a section of this channel may hold.
 *
 * The twin of `metricsForChannel`, and it exists for the same reason: a section
 * belongs to one network, and a card reading another network's endpoint would
 * be empty forever while looking like a broken pipeline. Before this, the card
 * drawer offered all ten tables in every section, so an Instagram dashboard
 * listed the Facebook Page tables and the ad-account ones.
 *
 * A channel with no integration returns nothing, exactly as the metric catalog
 * does for `google_ads` — the channel's own "em breve" state is the honest
 * answer there, not a list of tables that cannot be filled.
 */
export function tableSourcesForChannel(channel: ChannelId): TableSourceDefinition[] {
  return TABLE_SOURCES.filter((source) => source.channels.includes(channel) && !["campaigns", "ad_sets", "ads"].includes(source.id));
}

/** Whether a source is the one-row interactions table rather than a ranking. */
export function isInteractionsSource(id: string): boolean {
  const kind = findTableSource(id).kind;
  return kind === "interactions" || kind === "ad_interactions";
}

export function findTableColumn(source: TableSourceDefinition, columnId: string): TableColumnDefinition | null {
  return source.columns.find((column) => column.id === columnId) ?? null;
}

/** Row limits the drawer offers. Bounded because the API returns everything. */
export const TABLE_ROW_LIMITS = [5, 10, 25, 50] as const;

export const DEFAULT_TABLE_ROW_LIMIT = 10;

export function clampRowLimit(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_TABLE_ROW_LIMIT;

  const max = TABLE_ROW_LIMITS[TABLE_ROW_LIMITS.length - 1];
  return Math.min(max, Math.max(TABLE_ROW_LIMITS[0], Math.round(parsed)));
}

/**
 * The columns a stored card actually renders, in its stored order.
 *
 * Columns the source no longer defines are dropped, and columns the source has
 * but the card never heard of are appended hidden. The second half is what
 * keeps a card built before a column existed from hiding it forever: it shows
 * up unticked in the drawer instead of being invisible there too.
 */
export function resolveTableColumns(
  source: TableSourceDefinition,
  stored: Array<{ id: string; visible: boolean }>,
): Array<{ column: TableColumnDefinition; visible: boolean }> {
  const seen = new Set<string>();
  const resolved: Array<{ column: TableColumnDefinition; visible: boolean }> = [];

  for (const entry of stored) {
    const column = findTableColumn(source, entry.id);
    if (!column || seen.has(column.id)) continue;

    seen.add(column.id);
    resolved.push({ column, visible: entry.visible });
  }

  for (const column of source.columns) {
    if (seen.has(column.id)) continue;
    resolved.push({ column, visible: false });
  }

  return resolved;
}

/**
 * One cell's raw value, before formatting.
 *
 * `null` means the row has nothing for this column — Meta states optimisation
 * on the ad set and nowhere else, and a campaign row asked for it has no
 * answer rather than an empty one.
 */
export function readTableCell(
  row:
    | SocialAdCampaignRow
    | SocialAdAdSetRow
    | SocialAdAdRow
    | SocialAdConversionTotal
    | SocialAdActionTypeTotal
    | SocialOrganicTopPost
    | SocialOrganicFacebookReel,
  columnId: string,
): string | null {
  const record = row as unknown as Record<string, unknown>;
  const value = record[columnId];

  if (value === null || value === undefined) return null;

  // The absorbed alias list is the one array-valued cell. Joined here rather
  // than left to `String()`, which would render it comma-separated with no
  // spaces and, for an empty list, as an empty string that reads as a missing
  // value rather than as "nothing was folded into this row".
  if (Array.isArray(value)) {
    return value.length > 0 ? value.join(", ") : null;
  }

  return typeof value === "string" ? value : String(value as number | boolean | bigint);
}

/**
 * Whether a stored source id names an organic post ranking.
 *
 * Reading the definition rather than listing the ids again: a fourth surface
 * added to `TABLE_SOURCES` is answered correctly here without this function
 * being touched, which is the whole reason `kind` is a field.
 */
export function isOrganicTableSource(id: string): boolean {
  return SOURCES_BY_ID.get(id as TableSourceId)?.kind === "organic";
}

/**
 * A column's sort key, narrowed to the family that will receive it.
 *
 * `TableColumnDefinition.sortKey` is a union of the two APIs' closed sets,
 * because one type describes columns of both. But a column only ever reaches
 * the endpoint of the source that declared it, so at the call site exactly one
 * half of that union is possible — and these two functions are where that fact
 * is asserted, once, next to the lists that make it true. The alternative is a
 * cast at each fetch, which puts the claim somewhere nothing verifies it.
 *
 * The mismatch case returns null rather than throwing: a card stored with a
 * source and a sort column that no longer agree is a stale layout, and it
 * should fall back to the endpoint's default ordering, not fail to render.
 */
export function paidSortKey(source: TableSourceDefinition, columnId: string): TableSortKey | null {
  if (source.kind !== "paid") return null;
  return (findTableColumn(source, columnId)?.sortKey as TableSortKey) ?? null;
}

export function organicSortKey(source: TableSourceDefinition, columnId: string): SocialOrganicTopPostSort | null {
  if (source.kind !== "organic") return null;
  return (findTableColumn(source, columnId)?.sortKey as SocialOrganicTopPostSort) ?? null;
}

export function facebookReelSortKey(source: TableSourceDefinition, columnId: string): SocialOrganicFacebookReelSort | null {
  if (source.kind !== "facebook_reels") return null;
  return (findTableColumn(source, columnId)?.sortKey as SocialOrganicFacebookReelSort) ?? null;
}
