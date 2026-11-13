/**
 * E5 — what the generated work says. Written once, when the task or subtask
 * is created: from then on it belongs to whoever edits it in Projects.
 */

export type WorkCatalog = Array<{ key: string; label: string }>;
export type WorkLabels = {
  formats: WorkCatalog;
  types: WorkCatalog;
  objectives: WorkCatalog;
};

export type WorkItemFacts = {
  title: string;
  theme: string | null;
  plannedDate: string | null;
  creativeFormat: string | null;
  funnelStage: string | null;
  contentType: string | null;
  objective: string | null;
  cta: string | null;
};

export type WorkPlanFacts = {
  title: string;
  periodStart: string | null;
  periodEnd: string | null;
  primaryObjective: string | null;
  strategyMode: string | null;
};

export type WorkDestination = { channel: string; placement: string };

const FUNNEL: Record<string, string> = {
  discovery: 'Descoberta',
  recognition: 'Reconhecimento',
  consideration: 'Consideração',
  decision: 'Decisão',
};

/** The stored key stays `always_on`; the label is what the modal shows. */
const STRATEGY: Record<string, string> = {
  always_on: 'Posts para Redes Sociais',
  campaign: 'Campanha',
  seasonal: 'Sazonal',
};

const CHANNELS: Record<string, string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  linkedin: 'LinkedIn',
  tiktok: 'TikTok',
  youtube: 'YouTube',
};

const PLACEMENTS: Record<string, string> = {
  feed: 'Feed',
  story: 'Story',
  stories: 'Story',
  reel: 'Reels',
  reels: 'Reels',
  short: 'Shorts',
  post: 'Post',
};

const EMPTY = '—';

function label(catalog: WorkCatalog, key: string | null): string | null {
  if (!key) return null;
  return catalog.find((entry) => entry.key === key)?.label ?? key;
}

function clean(value: string | null | undefined): string | null {
  const text = value?.replace(/\s+/g, ' ').trim();
  return text ? text : null;
}

/** A date-only value is read from its parts so it never shifts a day. */
function dateParts(value: string | null) {
  return value?.match(/^(\d{4})-(\d{2})-(\d{2})/) ?? null;
}

export function dayMonth(value: string | null): string | null {
  const parts = dateParts(value);
  return parts ? `${parts[3]}/${parts[2]}` : null;
}

export function fullDate(value: string | null): string | null {
  const parts = dateParts(value);
  return parts ? `${parts[3]}/${parts[2]}/${parts[1]}` : null;
}

export function channelsText(destinations: readonly WorkDestination[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const { channel, placement } of destinations) {
    const key = channel.toLowerCase();
    const name =
      Object.entries(CHANNELS).find(([id]) => key.includes(id))?.[1] ?? channel;
    const where = PLACEMENTS[placement.toLowerCase()] ?? placement;
    const text = `${name} · ${where}`;
    if (!seen.has(text)) out.push(text);
    seen.add(text);
  }
  return out.join(', ') || null;
}

/** "05/12 · Plano de Dezembro": the post day comes first in the task list. */
export function itemTaskTitle(item: WorkItemFacts, planTitle: string) {
  const name = clean(planTitle) ?? clean(item.title) ?? 'Conteúdo';
  const day = dayMonth(item.plannedDate);
  return day ? `${day} · ${name}` : name;
}

/** One task per item: a field per line, the same order as the Planner grid. */
export function itemTaskDescription(
  item: WorkItemFacts,
  destinations: readonly WorkDestination[],
  labels: WorkLabels,
): string {
  const rows: Array<[string, string | null]> = [
    ['Data', fullDate(item.plannedDate)],
    ['Tema', clean(item.theme)],
    ['Conteúdo', clean(item.title)],
    ['Canais', channelsText(destinations)],
    ['Formato', label(labels.formats, item.creativeFormat)],
    [
      'Funil',
      item.funnelStage ? (FUNNEL[item.funnelStage] ?? item.funnelStage) : null,
    ],
    ['Tipo', label(labels.types, item.contentType)],
    ['Objetivo', label(labels.objectives, clean(item.objective))],
    ['CTA', clean(item.cta)],
  ];
  return rows.map(([name, value]) => `${name}: ${value ?? EMPTY}`).join('\n');
}

/** One task for the plan: its period and direction. */
export function planTaskDescription(plan: WorkPlanFacts): string {
  const rows: Array<[string, string | null]> = [
    ['Início', fullDate(plan.periodStart)],
    ['Fim', fullDate(plan.periodEnd)],
    ['Objetivo principal', clean(plan.primaryObjective)],
    [
      'Modo estratégico',
      plan.strategyMode
        ? (STRATEGY[plan.strategyMode] ?? plan.strategyMode)
        : null,
    ],
  ];
  return rows.map(([name, value]) => `${name}: ${value ?? EMPTY}`).join('\n');
}

/** A subtask per item: one line, only what is filled, in grid order. */
export function itemSubtaskDescription(
  item: WorkItemFacts,
  destinations: readonly WorkDestination[],
  labels: WorkLabels,
): string {
  return [
    dayMonth(item.plannedDate),
    clean(item.theme),
    channelsText(destinations),
    label(labels.formats, item.creativeFormat),
    item.funnelStage ? (FUNNEL[item.funnelStage] ?? item.funnelStage) : null,
    label(labels.types, item.contentType),
    clean(item.cta),
  ]
    .filter((value): value is string => Boolean(value))
    .join(' · ');
}
