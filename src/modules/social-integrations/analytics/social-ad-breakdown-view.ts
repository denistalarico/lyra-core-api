import type { SocialAdBreakdownKind } from '../entities/social-ad-breakdown-daily.entity';

/** One bucket's additive totals over the window. */
export type SocialAdBreakdownBucket = {
  /** The stored provider key, unchanged. The join between row and label. */
  key: string;
  /**
   * The key rendered for a person, in pt-BR.
   *
   * Derived on read, never stored. A label written into the table would freeze
   * a translation at ingest time: revising "Desconhecido" would leave every
   * historical row carrying the old word, and a key whose label changed would
   * become a second bucket in the chart.
   */
  label: string;
  spend: string | null;
  impressions: string | null;
  clicks: string | null;
  linkClicks: string | null;
  /**
   * Always `null` in this view, and it is not an omission.
   *
   * The column exists and holds the provider's per-day, per-bucket figure — but
   * a *period* total cannot be produced from it in either direction. Reach does
   * not sum across days (the same person on two days is one person) and it does
   * not sum across buckets of one day either (a person reached on mobile and on
   * desktop is counted in both). Etapa 2B's `periodReach` is the measurement
   * that answers this honestly, and until a bucket-level equivalent exists the
   * truthful answer is an absence the UI can render as such.
   */
  reach: null;
};

/** One dimension's distribution over the window. */
export type SocialAdBreakdownView = {
  kind: SocialAdBreakdownKind;
  since: string;
  until: string;
  /** The zone whose calendar days the stored rows were cut in. */
  timezone: string;
  currency: string | null;
  /**
   * Whether the window holds any breakdown row at all.
   *
   * The measurement that separates "this dimension has not been ingested for
   * this window" from "nothing was delivered". Ingestion is gated off by
   * default, so an empty `buckets` is the *expected* state on a deployment that
   * has not opted in — and a UI that could not tell the two apart would render a
   * period of real spend as a period of no audience.
   */
  hasData: boolean;
  /** Days in the window that carry at least one row of this dimension. */
  coveredDays: number;
  /** Days the window asked about. */
  expectedDays: number;
  buckets: SocialAdBreakdownBucket[];
};

/** Gender values Meta reports on the `age,gender` cross. */
const GENDER_LABELS: Readonly<Record<string, string>> = {
  female: 'Feminino',
  male: 'Masculino',
  unknown: 'Não informado',
};

/** Device platforms Meta reports. */
const DEVICE_LABELS: Readonly<Record<string, string>> = {
  mobile_app: 'Aplicativo',
  mobile_web: 'Web no celular',
  desktop: 'Computador',
  unknown: 'Não informado',
};

/** Publisher platforms Meta reports. */
const PUBLISHER_LABELS: Readonly<Record<string, string>> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  messenger: 'Messenger',
  audience_network: 'Audience Network',
  threads: 'Threads',
  whatsapp: 'WhatsApp',
  unknown: 'Não informado',
};

/**
 * A stored key rendered for a person.
 *
 * Unknown keys fall through to the key itself rather than to a placeholder. Meta
 * adds platforms and device classes without notice, and a new one showing as
 * `threads` in a legend is a legible label that happens to be untranslated —
 * where "Desconhecido" would merge it with the genuine `unknown` bucket, which
 * already exists and means something different.
 *
 * `unknown` is translated, not hidden. It carries real delivery, and dropping it
 * would make the buckets fail to add up to the account total — the one property
 * a reader checks.
 */
export function describeBreakdownKey(
  kind: SocialAdBreakdownKind,
  key: string,
): string {
  if (kind === 'age_gender') {
    const [age, gender] = key.split('|');

    if (!age || !gender) return key;

    // Age is Meta's own bracket (`25-34`, `65+`) and needs no translation; only
    // the gender half has a word in it.
    return `${age} · ${GENDER_LABELS[gender] ?? gender}`;
  }

  if (kind === 'device_platform') return DEVICE_LABELS[key] ?? key;

  return PUBLISHER_LABELS[key] ?? key;
}

/**
 * Buckets in the order a chart should draw them.
 *
 * Age/gender sorts by its key, so the age brackets stay in their natural order
 * and each age holds its genders together — the arrangement a grouped bar chart
 * needs, and one that does not move as spend does. Every other dimension sorts
 * by spend descending, which is what a pie or a ranked bar wants, with the key
 * as a tiebreak so equal spend does not produce an order that depends on
 * Postgres's physical row order.
 */
export function sortBreakdownBuckets(
  kind: SocialAdBreakdownKind,
  buckets: SocialAdBreakdownBucket[],
): SocialAdBreakdownBucket[] {
  if (kind === 'age_gender') {
    return [...buckets].sort((left, right) =>
      left.key.localeCompare(right.key),
    );
  }

  return [...buckets].sort((left, right) => {
    const bySpend = compareDecimal(right.spend, left.spend);

    return bySpend !== 0 ? bySpend : left.key.localeCompare(right.key);
  });
}

/**
 * Compares two `numeric` strings without turning either into a float.
 *
 * Spend is `numeric(18,6)`; parsing it into a double to sort would be a second
 * place where money becomes binary floating point, and the comparison would be
 * wrong in exactly the cases where two buckets are close.
 */
function compareDecimal(left: string | null, right: string | null): number {
  if (left === right) return 0;
  if (left === null) return -1;
  if (right === null) return 1;

  const scale = (value: string): bigint => {
    const [whole, fraction = ''] = value.split('.');

    return BigInt(`${whole || '0'}${fraction.padEnd(6, '0').slice(0, 6)}`);
  };

  const difference = scale(left) - scale(right);

  return difference === 0n ? 0 : difference > 0n ? 1 : -1;
}
