/**
 * The typed card bodies the dashboard grid renders — §4.1 of the plan.
 *
 * The backend stores these verbatim: `dashboard-layout.contract.ts` validates
 * the envelope (`id`, `kind`, `size`) and passes the rest through untouched, so
 * that the shape of a card lives in one place instead of two that have to be
 * migrated in lockstep. That makes this module the authority — and it also means
 * a document read back from the server is *untrusted* here in exactly the way an
 * API response is: it may have been written by an older build of this app, or by
 * a newer one after a rollback. `parseDashboardCard` below is what turns it into
 * something the renderer can rely on.
 */

import { isChannelId, type ChannelId } from "./social-channels";
import { isMetricId, type MetricId } from "./social-metric.catalog";
import {
  clampRowLimit,
  isTableSourceId,
  type TableSourceId,
} from "./social-table-sources";
import type {
  SocialDashboardCard,
  SocialDashboardLayout,
  SocialDashboardSection,
} from "./social-dashboard.types";

export const ANALYTICS_CHART_TYPES = ["bar", "line", "area", "pie"] as const;

export type AnalyticsChartType = (typeof ANALYTICS_CHART_TYPES)[number];

export const CHART_TYPE_LABELS: Record<AnalyticsChartType, string> = {
  bar: "Barras",
  line: "Linhas",
  area: "Área",
  pie: "Pizza",
};

/** How a value is written out, independent of the metric's own format. */
export type CardDisplay = "absolute" | "percent";

/** Fields every card carries, whatever it draws. */
type CardCommon = {
  id: string;
  title: string;
  description: string | null;
  size: { w: number; h: number };
  /** Preferred zero-based column chosen by the operator. */
  gridColumn?: number;
  /**
   * Preferred zero-based row chosen by the operator. The grid removes an
   * entirely empty row after every move, while preserving gaps within a row.
   */
  gridRow?: number;
  /**
   * The network this card reads, when the block alone does not say.
   *
   * Only set on cards placed in the Resumo block from one of the network tabs
   * of the drawer. A network block reads its own channel and ignores this; in
   * Resumo it is what tells "Seguidores" of the Page from "Seguidores" of the
   * Instagram account — the metric id is the same for both. See
   * `analyticsCardChannel.ts`.
   */
  channel?: ChannelId;
};

export type AnalyticsKpiCard = CardCommon & {
  kind: "kpi";
  metric: MetricId;
  decimals: number;
  display: CardDisplay;
  /** Renders larger, in the product colour. One card's emphasis, not a sort. */
  highlighted: boolean;
  /**
   * Marks a tile sized under the one-row rule (2026-09-27).
   *
   * Every KPI used to open two rows tall, because the tile could not fit in
   * one. A stored tile without this mark and at that old default is read as
   * one row; with the mark, its height is the operator's and is kept — two
   * rows on a marked tile is a choice, not the old default.
   */
  compactHeight: true;
};

export type AnalyticsChartCard = CardCommon & {
  kind: "chart";
  metricIds: MetricId[];
  chartType: AnalyticsChartType;
  decimals: number;
  display: CardDisplay;
  stacked: boolean;
  grouped: boolean;
};

export type AnalyticsTableCard = CardCommon & {
  kind: "table";
  source: TableSourceId;
  /** Order of the array is the order of the columns. */
  columns: Array<{ id: string; visible: boolean }>;
  sort: { columnId: string; direction: "asc" | "desc" };
  rowLimit: number;
};

export type AnalyticsFunnelCard = CardCommon & {
  kind: "funnel";
  orientation: "vertical" | "horizontal";
  steps: Array<{ id: string; metric: MetricId; label: string }>;
};

/**
 * One distribution metric, drawn as buckets.
 *
 * Separate from `AnalyticsChartCard` because that card plots *several scalar
 * metrics over time* — its `metricIds` are series and its x-axis is the
 * calendar. A breakdown has one metric and its x-axis is a dimension
 * (gender, age, device, network, city), so the two cannot share a renderer
 * without one of them lying about what its axis means.
 *
 * `render` is the operator's choice between the two honest presentations of
 * the same buckets. It defaults from the metric's shape — `distribution` opens
 * as a chart, `ranking` as a table — and the catalog explains why cities are a
 * table: forty open-ended labels do not fit on an axis, and a top-5 bar chart
 * silently answers a narrower question than the one asked.
 */
export type AnalyticsBreakdownCard = CardCommon & {
  kind: "breakdown";
  metric: MetricId;
  render: "chart" | "table";
  /** Rows shown when `render` is "table". Ignored for charts. */
  rowLimit: number;
};

export type AnalyticsInsightCard = CardCommon & {
  kind: "insight";
  generatedAt: string;
  body: string;
  /**
   * Which model wrote it, kept with the text rather than alongside it.
   *
   * The card is frozen (§5/Etapa 8: not re-generated on render, because each
   * generation costs money), so months later the only record of how a given
   * paragraph came to exist is what the card itself carries. Optional because
   * cards written before this field existed are still valid documents.
   */
  model?: string | null;
  /** The estimated cost in cents, for the retroactive charge §6.3 anticipates. */
  costCents?: number | null;
};

export type AnalyticsDashboardCard =
  | AnalyticsKpiCard
  | AnalyticsChartCard
  | AnalyticsTableCard
  | AnalyticsBreakdownCard
  | AnalyticsFunnelCard
  | AnalyticsInsightCard;

/** The kinds of content a sub-block groups. */
export const SUB_BLOCK_CATEGORIES = ["posts", "reels", "stories"] as const;

export type SubBlockCategory = (typeof SUB_BLOCK_CATEGORIES)[number];

export function isSubBlockCategory(value: unknown): value is SubBlockCategory {
  return (SUB_BLOCK_CATEGORIES as readonly unknown[]).includes(value);
}

/**
 * A sub-block: one category of a network's content — its posts, its reels or
 * its stories — laid out as a grid of its own inside the block.
 *
 * It sits in the block's grid like a card, but it is not one: it has no
 * options menu (its cards are edited and exported one by one), its height is
 * whatever its cards need rather than a size the operator picks, and its
 * cards cannot leave it — each one reads the category the sub-block names, so
 * a reel KPI dragged out would sit under a heading that no longer says so.
 *
 * `size.w` is the operator's width, from half the block to all of it, and it
 * is also the number of columns the inner grid has: a column inside a
 * sub-block is as wide as one outside it, so a KPI does not shrink by being
 * grouped. `size.h` is stored as 1 only because the layout envelope requires
 * a height; the grid derives the real one from the cards
 * (`subBlockGridHeight`).
 */
export type AnalyticsSubBlock = {
  id: string;
  kind: "group";
  category: SubBlockCategory;
  title: string;
  size: { w: number; h: number };
  gridColumn?: number;
  gridRow?: number;
  /** Never another sub-block: one level of grouping, parsed as such. */
  cards: AnalyticsDashboardCard[];
};

/** What a block's grid holds: cards, and sub-blocks of cards. */
export type AnalyticsBlockItem = AnalyticsDashboardCard | AnalyticsSubBlock;

export function isSubBlock(
  item: AnalyticsBlockItem,
): item is AnalyticsSubBlock {
  return item.kind === "group";
}

/** Every card of a block, including the ones inside its sub-blocks. */
export function cardsOfItems(
  items: AnalyticsBlockItem[],
): AnalyticsDashboardCard[] {
  return items.flatMap((item) => (isSubBlock(item) ? item.cards : [item]));
}

export type AnalyticsDashboardSection = {
  id: string;
  channel: SocialDashboardSection["channel"];
  title: string;
  /** Editable line under the Resumo block's title; unused by network blocks. */
  description?: string | null;
  cards: AnalyticsBlockItem[];
};

/**
 * Whether a pie is a legitimate choice for a chart card — §4.1.
 *
 * A pie says "these parts make up this whole". Two stacked series, two grouped
 * series or two metrics are not parts of one whole, so the shape would assert
 * something false about the numbers rather than merely look wrong. The drawer
 * disables the option instead of ignoring the choice, because an option that
 * silently does nothing when clicked is read as a bug in the app rather than a
 * statement about the data.
 */
export function allowsPieChart(card: {
  stacked: boolean;
  grouped: boolean;
  metricIds: MetricId[];
}): boolean {
  return !card.stacked && !card.grouped && card.metricIds.length === 1;
}

export const MAX_CARD_DECIMALS = 4;

export function clampDecimals(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(parsed)) return 0;

  return Math.min(MAX_CARD_DECIMALS, Math.max(0, Math.round(parsed)));
}

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : fallback;
}

function readDescription(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readDisplay(value: unknown): CardDisplay {
  return value === "percent" ? "percent" : "absolute";
}

function readChartType(value: unknown): AnalyticsChartType {
  return (ANALYTICS_CHART_TYPES as readonly unknown[]).includes(value)
    ? (value as AnalyticsChartType)
    : "bar";
}

function readSize(value: unknown): { w: number; h: number } {
  const size = value as { w?: unknown; h?: unknown } | null | undefined;
  const w = Number(size?.w);
  const h = Number(size?.h);

  return {
    w: Number.isFinite(w) && w > 0 ? Math.round(w) : 1,
    h: Number.isFinite(h) && h > 0 ? Math.round(h) : 1,
  };
}

function readMetricIds(value: unknown): MetricId[] {
  if (!Array.isArray(value)) return [];

  // Unknown ids are dropped rather than kept as opaque strings: a card whose
  // metric no longer exists in the catalog has nothing to read, and carrying it
  // would push the decision into every renderer downstream.
  return value.filter(
    (entry): entry is MetricId =>
      typeof entry === "string" && isMetricId(entry),
  );
}

/**
 * Reads one stored card, or returns null if it cannot be rendered.
 *
 * Null rather than a placeholder card: a card kind this build does not
 * understand, or a KPI whose metric has been removed from the catalog, has no
 * honest rendering. The section drops it from the view and — importantly — does
 * *not* write the drop back, so a layout saved by a newer build is not quietly
 * truncated by an older tab that happened to be open.
 */
export function parseDashboardCard(
  raw: SocialDashboardCard,
): AnalyticsDashboardCard | null {
  const id = typeof raw.id === "string" ? raw.id : null;
  if (!id) return null;

  const gridColumn = readGridPosition(raw.gridColumn);
  const gridRow = readGridPosition(raw.gridRow);

  const common = {
    id,
    title: readString(raw.title, ""),
    description: readDescription(raw.description),
    size: readSize(raw.size),
    ...(gridColumn === null ? {} : { gridColumn }),
    ...(gridRow === null ? {} : { gridRow }),
    ...(isChannelId(raw.channel as string | undefined)
      ? { channel: raw.channel as ChannelId }
      : {}),
  };

  switch (raw.kind) {
    case "kpi": {
      const metric = raw.metric;
      if (typeof metric !== "string" || !isMetricId(metric)) return null;

      return {
        ...common,
        size:
          raw.compactHeight !== true && common.size.h === 2
            ? { ...common.size, h: 1 }
            : common.size,
        compactHeight: true,
        kind: "kpi",
        metric,
        decimals: clampDecimals(raw.decimals),
        display: readDisplay(raw.display),
        highlighted: raw.highlighted === true,
      };
    }
    case "chart": {
      const metricIds = readMetricIds(raw.metricIds);
      if (metricIds.length === 0) return null;

      const stacked = raw.stacked === true;
      const grouped = raw.grouped === true;
      const chartType = readChartType(raw.chartType);

      return {
        ...common,
        kind: "chart",
        metricIds,
        // A stored pie that is no longer legal — because a second metric was
        // added by another tab, say — falls back rather than drawing a shape
        // that misstates the numbers.
        chartType:
          chartType === "pie" &&
          !allowsPieChart({ stacked, grouped, metricIds })
            ? "bar"
            : chartType,
        decimals: clampDecimals(raw.decimals),
        display: readDisplay(raw.display),
        stacked,
        grouped,
      };
    }
    case "table": {
      const columns = Array.isArray(raw.columns)
        ? raw.columns.flatMap((column) => {
            const entry = column as { id?: unknown; visible?: unknown };
            return typeof entry?.id === "string"
              ? [{ id: entry.id, visible: entry.visible !== false }]
              : [];
          })
        : [];
      const sort = raw.sort as
        | { columnId?: unknown; direction?: unknown }
        | undefined;

      return {
        ...common,
        kind: "table",
        // An unknown source falls back to the first one rather than dropping
        // the card: the operator's column arrangement and title survive, which
        // is most of what they built.
        source: isTableSourceId(raw.source) ? raw.source : "campaigns",
        columns,
        sort: {
          columnId:
            typeof sort?.columnId === "string"
              ? sort.columnId
              : (columns[0]?.id ?? ""),
          direction: sort?.direction === "asc" ? "asc" : "desc",
        },
        rowLimit: clampRowLimit(raw.rowLimit),
      };
    }
    case "breakdown": {
      // A card whose metric no longer exists is dropped rather than defaulted:
      // unlike a table's `source`, the metric IS the card here — there is no
      // arrangement left to preserve once it is gone, and substituting another
      // metric would silently retitle the operator's card.
      const metric = raw.metric;
      if (typeof metric !== "string" || !isMetricId(metric)) return null;

      return {
        ...common,
        kind: "breakdown",
        metric,
        render: raw.render === "table" ? "table" : "chart",
        rowLimit: clampRowLimit(raw.rowLimit),
      };
    }
    case "funnel": {
      const steps = Array.isArray(raw.steps)
        ? raw.steps.flatMap((step) => {
            const entry = step as {
              id?: unknown;
              metric?: unknown;
              label?: unknown;
            };

            return typeof entry?.id === "string" &&
              typeof entry.metric === "string" &&
              isMetricId(entry.metric)
              ? [
                  {
                    id: entry.id,
                    metric: entry.metric,
                    label: readString(entry.label, entry.metric),
                  },
                ]
              : [];
          })
        : [];

      return {
        ...common,
        kind: "funnel",
        orientation:
          raw.orientation === "horizontal" ? "horizontal" : "vertical",
        steps,
      };
    }
    case "insight":
      return {
        ...common,
        kind: "insight",
        generatedAt: readString(raw.generatedAt, ""),
        body: typeof raw.body === "string" ? raw.body : "",
        model: typeof raw.model === "string" ? raw.model : null,
        costCents:
          typeof raw.costCents === "number" && Number.isFinite(raw.costCents)
            ? raw.costCents
            : null,
      };
    default:
      return null;
  }
}

/**
 * Reads one stored sub-block, or null if it cannot be rendered.
 *
 * Its cards go through `parseDashboardCard` like any other, and a sub-block
 * found inside one is dropped: there is one level of grouping, and a nested
 * one would be a layout this build has no way to lay out.
 */
export function parseSubBlock(
  raw: SocialDashboardCard,
): AnalyticsSubBlock | null {
  const id = typeof raw.id === "string" ? raw.id : null;
  if (!id || raw.kind !== "group" || !isSubBlockCategory(raw.category)) {
    return null;
  }

  const gridColumn = readGridPosition(raw.gridColumn);
  const gridRow = readGridPosition(raw.gridRow);

  return {
    id,
    kind: "group",
    category: raw.category,
    title: readString(raw.title, ""),
    size: { w: readSize(raw.size).w, h: 1 },
    ...(gridColumn === null ? {} : { gridColumn }),
    ...(gridRow === null ? {} : { gridRow }),
    cards: Array.isArray(raw.cards)
      ? (raw.cards as SocialDashboardCard[]).flatMap((card) => {
          const parsed = parseDashboardCard(card);
          return parsed ? [parsed] : [];
        })
      : [],
  };
}

/** One entry of a block's grid: a card, a sub-block, or null. */
export function parseBlockItem(
  raw: SocialDashboardCard,
): AnalyticsBlockItem | null {
  return raw.kind === "group" ? parseSubBlock(raw) : parseDashboardCard(raw);
}

function readGridPosition(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);

  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : null;
}

export function parseDashboardSections(
  layout: SocialDashboardLayout | null | undefined,
): AnalyticsDashboardSection[] {
  if (!layout || !Array.isArray(layout.sections)) return [];

  return layout.sections.map((section) => ({
    id: section.id,
    channel: section.channel,
    title: section.title,
    description:
      typeof section.description === "string" ? section.description : null,
    cards: (section.cards ?? []).flatMap((card) => {
      const parsed = parseBlockItem(card);
      return parsed ? [parsed] : [];
    }),
  }));
}

/** The stored shape of a parsed card, ready to go back into `layout`. */
export function serializeDashboardCard(
  card: AnalyticsBlockItem,
): SocialDashboardCard {
  if (isSubBlock(card)) {
    return {
      ...(card as unknown as SocialDashboardCard),
      size: { w: card.size.w, h: 1 },
      cards: card.cards.map(serializeDashboardCard),
    };
  }

  return card as unknown as SocialDashboardCard;
}

export function serializeSections(
  sections: AnalyticsDashboardSection[],
): SocialDashboardLayout {
  return {
    version: 1,
    sections: sections.map((section) => ({
      id: section.id,
      channel: section.channel,
      title: section.title,
      // Only sent when there is one, so a layout that never had a description
      // round-trips byte for byte.
      ...(section.description ? { description: section.description } : {}),
      cards: section.cards.map(serializeDashboardCard),
    })),
  };
}
