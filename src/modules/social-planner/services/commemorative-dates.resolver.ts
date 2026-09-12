import {
  COMMEMORATIVE_DATES,
  easterSunday,
  type CommemorativeDateCatalogItem,
  type CommemorativeDateRule,
  type CommemorativeDateSignificance,
  type SocialBusinessModeKey,
} from '../catalog/commemorative-dates.catalog';

/**
 * Expands the rule-based commemorative catalog into concrete dates.
 *
 * WHY THIS IS A PURE FUNCTION WITH NO `Date` ARITHMETIC ON LOCAL TIME
 * ------------------------------------------------------------------
 * Every date here is an editorial calendar day — "Christmas is December 25th" —
 * not an instant. Building it with `new Date(y, m, d)` and formatting it back
 * would run through the server's local timezone, and a server in UTC-3 would
 * hand back the 24th for anything constructed at midnight UTC. So the month and
 * day are computed as integers and only ever assembled into a `YYYY-MM-DD`
 * string. The one place real date arithmetic is unavoidable — offsets from
 * Easter, and "the day after the 4th Thursday" — uses `Date.UTC` and reads the
 * UTC getters back, which keeps the whole computation inside one timezone.
 */

export interface ResolvedCommemorativeDate {
  key: string;
  label: string;
  /** ISO calendar day, `YYYY-MM-DD`. */
  date: string;
  country: string;
  significance: CommemorativeDateSignificance;
}

export interface ResolveCommemorativeDatesInput {
  /** Inclusive, `YYYY-MM-DD`. */
  periodStart: string;
  /** Inclusive, `YYYY-MM-DD`. */
  periodEnd: string;
  /** ISO 3166-1 alpha-2. GLOBAL dates are always included. */
  country: string | null;
  /** NULL includes every date; a mode narrows to the ones tagged for it. */
  businessMode: SocialBusinessModeKey | null;
}

/**
 * Dates whose rule places them inside the period, sorted chronologically.
 *
 * A period spanning a year boundary is resolved by evaluating every year it
 * touches, which is the whole reason the catalog stores rules: a quarterly plan
 * from November to January is an ordinary request, not an edge case.
 */
export function resolveCommemorativeDates(
  input: ResolveCommemorativeDatesInput,
  catalog: CommemorativeDateCatalogItem[] = COMMEMORATIVE_DATES,
): ResolvedCommemorativeDate[] {
  const start = parseIsoDate(input.periodStart);
  const end = parseIsoDate(input.periodEnd);
  if (!start || !end || input.periodEnd < input.periodStart) return [];

  const country = normalizeCountry(input.country);
  const years = yearRange(start.year, end.year);
  const resolved: ResolvedCommemorativeDate[] = [];

  for (const item of catalog) {
    if (!matchesCountry(item, country)) continue;
    if (!matchesBusinessMode(item, input.businessMode)) continue;

    for (const year of years) {
      const date = resolveRule(item.rule, year);
      if (!date) continue;
      if (date < input.periodStart || date > input.periodEnd) continue;

      resolved.push({
        key: item.key,
        label: item.label,
        date,
        country: item.country,
        significance: item.significance,
      });
    }
  }

  /**
   * National first within a day, so a client rendering the list in order sees
   * the date that deserves visual weight at the top of that day's group.
   */
  return resolved.sort(
    (left, right) =>
      left.date.localeCompare(right.date) ||
      significanceRank(left.significance) -
        significanceRank(right.significance) ||
      left.label.localeCompare(right.label),
  );
}

/**
 * The same expansion, but for keys the operator already picked.
 *
 * The plan generator needs this: the client sends back a list of keys, and the
 * dates have to be re-derived server-side rather than trusted from the body.
 * A key the catalog does not know is dropped silently — an unknown key is not
 * worth failing a whole plan generation over.
 */
export function resolveCommemorativeDatesByKey(
  keys: string[],
  period: { periodStart: string; periodEnd: string },
  catalog: CommemorativeDateCatalogItem[] = COMMEMORATIVE_DATES,
): ResolvedCommemorativeDate[] {
  const wanted = new Set(keys);
  if (wanted.size === 0) return [];

  return resolveCommemorativeDates(
    {
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      // Country and mode filters are not applied: the operator already chose
      // these keys, and re-filtering could drop a date they explicitly ticked.
      country: null,
      businessMode: null,
    },
    catalog.filter((item) => wanted.has(item.key)),
  );
}

function resolveRule(rule: CommemorativeDateRule, year: number): string | null {
  switch (rule.kind) {
    case 'fixed':
      return isoDate(year, rule.month, rule.day);

    case 'easter': {
      const easter = easterSunday(year);
      return shiftDays(year, easter.month, easter.day, rule.offsetDays);
    }

    case 'weekday': {
      const base = nthWeekdayOfMonth(
        year,
        rule.month,
        rule.weekday,
        rule.ordinal,
      );
      if (!base) return null;
      return rule.offsetDays
        ? shiftDays(year, rule.month, base, rule.offsetDays)
        : isoDate(year, rule.month, base);
    }

    default:
      return null;
  }
}

/**
 * Day-of-month for the Nth `weekday` of a month, where weekday is 1 = Sunday.
 * A negative ordinal counts back from the end, which is how Memorial Day ("last
 * Monday of May") is expressed. Returns NULL when the month has no such
 * occurrence, e.g. a 5th Monday that does not exist that year.
 */
function nthWeekdayOfMonth(
  year: number,
  month: number,
  weekday: number,
  ordinal: number,
): number | null {
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const matching: number[] = [];

  for (let day = 1; day <= daysInMonth; day += 1) {
    const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    // getUTCDay is 0 = Sunday; the catalog counts 1 = Sunday.
    if (dow + 1 === weekday) matching.push(day);
  }

  const index = ordinal > 0 ? ordinal - 1 : matching.length + ordinal;
  return matching[index] ?? null;
}

function shiftDays(
  year: number,
  month: number,
  day: number,
  offsetDays: number,
): string {
  const shifted = new Date(Date.UTC(year, month - 1, day + offsetDays));
  return isoDate(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
  );
}

function isoDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseIsoDate(value: string): { year: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? '');
  return match ? { year: Number(match[1]) } : null;
}

/**
 * Capped so a malformed or hostile period cannot make the resolver iterate
 * thousands of years building a list nobody asked for.
 */
function yearRange(startYear: number, endYear: number): number[] {
  const years: number[] = [];
  const last = Math.min(endYear, startYear + 5);
  for (let year = startYear; year <= last; year += 1) years.push(year);
  return years;
}

function normalizeCountry(country: string | null): string | null {
  const trimmed = country?.trim().toUpperCase();
  return trimmed && /^[A-Z]{2}$/.test(trimmed) ? trimmed : null;
}

/**
 * GLOBAL dates are observed everywhere, so they survive any country filter. A
 * NULL country means the operator has not configured one yet — everything is
 * offered rather than nothing, because an empty picker reads as a broken
 * feature while a long one reads as an unfiltered one.
 */
function matchesCountry(
  item: CommemorativeDateCatalogItem,
  country: string | null,
): boolean {
  if (item.country === 'GLOBAL') return true;
  return country === null ? true : item.country === country;
}

function matchesBusinessMode(
  item: CommemorativeDateCatalogItem,
  businessMode: SocialBusinessModeKey | null,
): boolean {
  if (item.businessModes === null) return true;
  if (businessMode === null) return true;
  return item.businessModes.includes(businessMode);
}

function significanceRank(significance: CommemorativeDateSignificance): number {
  switch (significance) {
    case 'national':
      return 0;
    case 'commercial':
      return 1;
    default:
      return 2;
  }
}
