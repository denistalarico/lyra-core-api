import type { Ga4Dimension } from './entities';
import type { Ga4ReportRow } from './ga4-data.client';

/** Rows kept per property, day and dimension; the rest folds into `(other)`. */
export const GA4_TOP_N_PER_DAY = 50;
export const GA4_OTHER_BUCKET = '(other)';
const MAX_VALUE_LENGTH = 300;

/** Metrics of the daily report, in request order. */
export const GA4_DAILY_METRICS = [
  'sessions',
  'totalUsers',
  'newUsers',
  'engagedSessions',
  'averageSessionDuration',
  'screenPageViews',
  'eventCount',
  'keyEvents',
  'totalRevenue',
] as const;

/** Metrics of every dimension report, in request order. */
export const GA4_DIMENSION_METRICS = [
  'sessions',
  'engagedSessions',
  'totalUsers',
  'keyEvents',
  'totalRevenue',
] as const;

/** Google dimension name behind each stored dimension (Data API v1beta). */
export const GA4_DIMENSION_API_NAMES: Record<Ga4Dimension, string> = {
  channel_group: 'sessionDefaultChannelGroup',
  source_medium: 'sessionSourceMedium',
  campaign: 'sessionCampaignName',
  landing_page: 'landingPagePlusQueryString',
  device: 'deviceCategory',
  country: 'country',
};

export type Ga4DailyRow = {
  metricDate: string;
  sessions: number;
  totalUsers: number;
  newUsers: number;
  engagedSessions: number;
  avgSessionSeconds: number;
  pageViews: number;
  eventCount: number;
  keyEvents: number;
  totalRevenue: number;
};

export type Ga4DimensionRow = {
  metricDate: string;
  dimension: Ga4Dimension;
  value: string;
  sessions: number;
  engagedSessions: number;
  totalUsers: number;
  keyEvents: number;
  totalRevenue: number;
};

/** GA4 writes dates as `YYYYMMDD`; null for anything else. */
export function parseGa4Date(raw: string): string | null {
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(raw);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

export function normalizeDailyRows(rows: Ga4ReportRow[]): Ga4DailyRow[] {
  const out: Ga4DailyRow[] = [];
  for (const row of rows) {
    const metricDate = parseGa4Date(row.dimensions[0] ?? '');
    if (!metricDate) continue;
    const [
      sessions,
      totalUsers,
      newUsers,
      engagedSessions,
      avg,
      pageViews,
      eventCount,
      keyEvents,
      totalRevenue,
    ] = row.metrics;
    out.push({
      metricDate,
      sessions: Math.round(sessions ?? 0),
      totalUsers: Math.round(totalUsers ?? 0),
      newUsers: Math.round(newUsers ?? 0),
      engagedSessions: Math.round(engagedSessions ?? 0),
      avgSessionSeconds: avg ?? 0,
      pageViews: Math.round(pageViews ?? 0),
      eventCount: Math.round(eventCount ?? 0),
      keyEvents: keyEvents ?? 0,
      totalRevenue: totalRevenue ?? 0,
    });
  }
  return out;
}

function cleanValue(raw: string): string {
  const value = raw.trim();
  return (value || '(not set)').slice(0, MAX_VALUE_LENGTH);
}

/**
 * Top N per day by sessions, the remainder folded into one `(other)` row (R-02).
 * Rows that collapse to the same cleaned value (trim/truncation) are merged so
 * the unique key is never hit twice in one batch.
 */
export function normalizeDimensionRows(
  dimension: Ga4Dimension,
  rows: Ga4ReportRow[],
  topN = GA4_TOP_N_PER_DAY,
): Ga4DimensionRow[] {
  const byDay = new Map<string, Map<string, Ga4DimensionRow>>();
  for (const row of rows) {
    const metricDate = parseGa4Date(row.dimensions[0] ?? '');
    if (!metricDate) continue;
    const value = cleanValue(row.dimensions[1] ?? '');
    const day = byDay.get(metricDate) ?? new Map<string, Ga4DimensionRow>();
    byDay.set(metricDate, day);
    const current = day.get(value) ?? {
      metricDate,
      dimension,
      value,
      sessions: 0,
      engagedSessions: 0,
      totalUsers: 0,
      keyEvents: 0,
      totalRevenue: 0,
    };
    current.sessions += Math.round(row.metrics[0] ?? 0);
    current.engagedSessions += Math.round(row.metrics[1] ?? 0);
    current.totalUsers += Math.round(row.metrics[2] ?? 0);
    current.keyEvents += row.metrics[3] ?? 0;
    current.totalRevenue += row.metrics[4] ?? 0;
    day.set(value, current);
  }

  const out: Ga4DimensionRow[] = [];
  for (const day of byDay.values()) {
    const ranked = [...day.values()].sort((a, b) => b.sessions - a.sessions);
    const kept = ranked.slice(0, topN);
    out.push(...kept);
    const tail = ranked.slice(topN);
    if (tail.length === 0) continue;
    // A property can literally report "(other)"; fold into it so the batch
    // never carries the same unique key twice.
    const other: Ga4DimensionRow = kept.find(
      (row) => row.value === GA4_OTHER_BUCKET,
    ) ?? {
      metricDate: tail[0].metricDate,
      dimension,
      value: GA4_OTHER_BUCKET,
      sessions: 0,
      engagedSessions: 0,
      totalUsers: 0,
      keyEvents: 0,
      totalRevenue: 0,
    };
    const alreadyKept = kept.includes(other);
    for (const row of tail) {
      other.sessions += row.sessions;
      other.engagedSessions += row.engagedSessions;
      other.totalUsers += row.totalUsers;
      other.keyEvents += row.keyEvents;
      other.totalRevenue += row.totalRevenue;
    }
    if (!alreadyKept) out.push(other);
  }
  return out;
}
