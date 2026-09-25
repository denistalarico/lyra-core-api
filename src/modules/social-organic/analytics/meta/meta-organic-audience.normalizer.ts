import type { SocialOrganicAudienceKind } from '../entities/social-organic-audience-daily.entity';
import type { NormalizedOrganicAudienceDaily } from '../social-organic-audience.contract';

/**
 * The alphabet a stored audience key may use.
 *
 * Meta's own values across these dimensions are lowercase words, digits,
 * hyphens, `+` (`65+`), the `|` this normalizer joins an age/gender pair with,
 * and — for cities — spaces, commas, dots and accented letters (`são paulo,
 * brazil`). A value outside this set is not a bucket this code understands, and
 * storing it would put an unlabelled slice in a chart.
 */
const AUDIENCE_KEY_PATTERN = /^[\p{L}\p{N} .,'|+_-]+$/u;

/** The column's own ceiling; a longer key is a payload this code misread. */
const MAX_AUDIENCE_KEY_LENGTH = 96;

/** Everything about a pass that a single bucket cannot learn from its payload. */
export type AudienceNormalizeContext = {
  tenantId: string;
  workspaceId: string;
  agencyClientId: string | null;
  assetId: string;
  provider: string;
  /** The day of *observation*; a lifetime total has no period of its own. */
  metricDate: string;
  assetTimezone: string;
  observedAt: Date;
  syncedAt: Date;
  syncRunId: string | null;
};

export class MetaOrganicAudienceNormalizationError extends Error {
  readonly code = 'meta_invalid_response';

  constructor() {
    super('meta_invalid_response');
    this.name = 'MetaOrganicAudienceNormalizationError';
  }
}

/**
 * Instagram's `follower_demographics` into audience rows.
 *
 * The metric arrives as a `total_value` with one `breakdowns` entry whose
 * `dimension_keys` name the requested dimension — `age`, `gender`, `city` or
 * `country` — and whose `results` carry a `dimension_values` array and a
 * `value`. One request per dimension, because Meta accepts exactly one
 * `breakdown` on this metric.
 *
 * An empty result list is **not** an error and not a zero: Meta withholds the
 * whole metric for accounts under 100 followers, and an account that legitimately
 * has no data yet must not be stored as an audience of zero people. It returns
 * no rows, and the read reports the absence.
 */
export function normalizeInstagramFollowerDemographics(
  input: AudienceNormalizeContext & {
    kind: SocialOrganicAudienceKind;
    insights: unknown;
  },
): NormalizedOrganicAudienceDaily[] {
  const metric = readMetric(input.insights, 'follower_demographics');

  if (!metric) return [];

  const rows: NormalizedOrganicAudienceDaily[] = [];

  for (const [key, value] of readTotalValueBreakdown(metric)) {
    const row = buildRow(input, input.kind, key, value);

    if (row) rows.push(row);
  }

  return rows;
}

/**
 * A Facebook Page's follower geography into audience rows.
 *
 * Live again, against `page_follows_city` and `page_follows_country` — see
 * `FACEBOOK_AUDIENCE_METRICS`. The `page_fans_*` names this was written for are
 * retired, but the replacements return the identical shape, so the parser did
 * not change; only its callers and this comment did.
 *
 * A different response shape from Instagram's, which is why this is a second
 * function rather than a flag: the Page insights edge reports these as a
 * `values` array whose last entry's `value` is a **map** from bucket to count
 * (`{"Rio Verde, GO, Brazil": 5}`), with no `breakdowns` anywhere. Reading both
 * shapes through one branching parser would mean a function where neither
 * shape's rules are stated plainly.
 *
 * Only the newest entry is read, and that is correct rather than lossy: these
 * metrics are **lifetime stocks that Meta happens to deliver under
 * `period=day`**, so every entry in the window is the whole distribution as of
 * its own day. Taking the last is taking today's snapshot; summing them would
 * count every follower once per day in the window.
 *
 * The `age_gender` path has no live metric behind it — no spelling of a Page
 * age or gender breakdown survives. It is kept for rows collected before the
 * retirement, whose keys are Facebook's gender-first `M.25-34` and are
 * rewritten to this table's canonical `25-34|male`.
 *
 * Buckets whose key Meta itself mangles are dropped by `readKey`: production
 * returns `"??gua Comprida, MG, Brazil"` for "Água Comprida", and a bucket
 * labelled with question marks is worse in a client's report than one fewer
 * city in a list Meta already truncates.
 */
export function normalizeFacebookFanDemographics(
  input: AudienceNormalizeContext & {
    kind: SocialOrganicAudienceKind;
    metricName: string;
    insights: unknown;
  },
): NormalizedOrganicAudienceDaily[] {
  const metric = readMetric(input.insights, input.metricName);

  if (!metric) return [];

  const map = readLifetimeValueMap(metric);

  if (!map) return [];

  const rows: NormalizedOrganicAudienceDaily[] = [];

  for (const [rawKey, value] of Object.entries(map)) {
    const key =
      input.kind === 'age_gender' ? rewriteFacebookAgeGender(rawKey) : rawKey;

    const row = buildRow(input, input.kind, key, value);

    if (row) rows.push(row);
  }

  return rows;
}

/**
 * One bucket into one row, or `null` if it cannot be trusted.
 *
 * A bucket whose key cannot be read is dropped rather than folded into an
 * `unknown` bucket, for the reason the paid normalizer states: merging
 * genuinely different audiences under one label leaves a total that is still
 * right and a chart that is silently wrong.
 */
function buildRow(
  context: AudienceNormalizeContext,
  kind: SocialOrganicAudienceKind,
  rawKey: string | null,
  rawValue: unknown,
): NormalizedOrganicAudienceDaily | null {
  const key = readKey(rawKey);

  if (!key) return null;

  const value = readDecimal(rawValue);

  if (value === null) return null;

  return {
    tenantId: context.tenantId,
    workspaceId: context.workspaceId,
    agencyClientId: context.agencyClientId,
    assetId: context.assetId,
    provider: context.provider,
    metricDate: context.metricDate,
    assetTimezone: context.assetTimezone,
    breakdownKind: kind,
    breakdownKey: key,
    value,
    observedAt: context.observedAt,
    syncedAt: context.syncedAt,
    syncRunId: context.syncRunId,
  };
}

/** One named metric out of an insights response, or nothing. */
function readMetric(
  payload: unknown,
  name: string,
): Record<string, unknown> | null {
  if (!isRecord(payload) || !Array.isArray(payload.data)) invalid();

  for (const candidate of payload.data as unknown[]) {
    if (!isRecord(candidate)) invalid();

    if (candidate.name === name) return candidate;
  }

  return null;
}

/**
 * The `(key, value)` pairs of a `total_value.breakdowns` response.
 *
 * `dimension_values` is an array because a breakdown can name several
 * dimensions; this pipeline asks for one at a time, so the pairs are joined with
 * the same `|` the paid table uses — and joined in the order Meta listed them,
 * which for a single-dimension request is the only order there is.
 */
function readTotalValueBreakdown(
  metric: Record<string, unknown>,
): Array<[string | null, unknown]> {
  if (!isRecord(metric.total_value)) return [];

  const breakdowns: unknown = metric.total_value.breakdowns;

  if (!Array.isArray(breakdowns)) return [];

  const pairs: Array<[string | null, unknown]> = [];

  for (const breakdown of breakdowns as unknown[]) {
    if (!isRecord(breakdown) || !Array.isArray(breakdown.results)) invalid();

    for (const result of breakdown.results as unknown[]) {
      if (!isRecord(result) || !Array.isArray(result.dimension_values)) {
        invalid();
      }

      const values = (result.dimension_values as unknown[]).map((value) =>
        typeof value === 'string' ? value : null,
      );

      pairs.push([
        values.includes(null) ? null : values.join('|'),
        result.value,
      ]);
    }
  }

  return pairs;
}

/**
 * The bucket map of a Page lifetime metric's newest value.
 *
 * The newest entry rather than the first: Meta returns the `values` array
 * oldest-first, and a Page insights read that spans two days would otherwise
 * file the older snapshot under today's date.
 */
function readLifetimeValueMap(
  metric: Record<string, unknown>,
): Record<string, unknown> | null {
  const values: unknown = metric.values;

  if (!Array.isArray(values) || values.length === 0) return null;

  const newest: unknown = (values as unknown[]).at(-1);

  if (!isRecord(newest)) invalid();

  return isRecord(newest.value) ? newest.value : null;
}

/**
 * `M.25-34` into `25-34|male`.
 *
 * Facebook reports gender first, abbreviated, dot-joined; Instagram reports age
 * first with a full word. Canonicalizing on Instagram's order means one key per
 * audience bucket across both providers — without it, a Page and an IG account
 * for the same brand would produce two disjoint sets of keys that no chart could
 * put on one axis.
 *
 * `U` is Meta's "unknown" gender and is kept: it carries real followers, and
 * dropping it would make the buckets fail to add up to the follower count.
 */
function rewriteFacebookAgeGender(key: string): string | null {
  const [gender, age] = key.split('.');

  if (!gender || !age) return null;

  const genders: Readonly<Record<string, string>> = {
    M: 'male',
    F: 'female',
    U: 'unknown',
  };

  const normalized = genders[gender.trim().toUpperCase()];

  return normalized ? `${age.trim()}|${normalized}` : null;
}

/**
 * A key lowercased, validated and bounded.
 *
 * Lowercasing is the only normalization applied, and it is what keeps a value
 * differing only in case from becoming a second bucket for the same audience —
 * two slices of one pie with the same label.
 */
function readKey(value: string | null): string | null {
  if (value === null) return null;

  const normalized = value.trim().toLowerCase();

  if (!normalized || !AUDIENCE_KEY_PATTERN.test(normalized)) return null;

  return normalized.length <= MAX_AUDIENCE_KEY_LENGTH ? normalized : null;
}

/**
 * A bucket value as the decimal string the `numeric` column takes.
 *
 * Decimal rather than integer because Meta's `total_value` breakdowns are not
 * always whole — some dimensions are reported as shares — and refusing a
 * fraction here would fail a whole sync over a number that stores fine.
 * Negative is refused: a negative follower count is a parsing failure, not a
 * fact, and the column's CHECK would reject it anyway.
 */
function readDecimal(value: unknown): string | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? String(value) : null;
  }

  if (typeof value !== 'string') return null;

  const trimmed = value.trim();

  return /^\d+(?:\.\d+)?$/.test(trimmed) ? trimmed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalid(): never {
  throw new MetaOrganicAudienceNormalizationError();
}
