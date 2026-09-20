import type { SocialOrganicAudienceKind } from '../entities/social-organic-audience-daily.entity';

/** One bucket of a follower-demographics snapshot. */
export type SocialOrganicAudienceBucket = {
  /** The stored provider key, unchanged. The join between row and label. */
  key: string;
  /**
   * The key rendered for a person, in pt-BR.
   *
   * Derived on read, never stored: a label written into the table would freeze a
   * translation at ingest time, and a key whose label later changed would become
   * a second bucket in the chart.
   */
  label: string;
  /** How many followers were in this bucket on `asOf`. Never summed. */
  value: string;
};

/** One dimension's distribution, as of the newest snapshot. */
export type SocialOrganicAudienceView = {
  kind: SocialOrganicAudienceKind;
  /**
   * The day of the snapshot these buckets come from, or `null` when none exists.
   *
   * The whole read is "one day's snapshot", never a range. Follower
   * demographics are a lifetime stock, so a period aggregate would count the
   * same people once per day in the window — and unlike reach, nothing about
   * the resulting number would look wrong.
   */
  asOf: string | null;
  /** The zone whose calendar days the snapshots were filed under. */
  timezone: string;
  /**
   * Whether any snapshot exists for this dimension.
   *
   * Empty has three causes a caller must be able to tell apart: ingestion has
   * not been enabled (the default), the account is below Meta's 100-follower
   * threshold for this metric, or the asset genuinely has no followers. Only the
   * third is a story about the audience, and a UI that read emptiness as that
   * one would be wrong on most deployments.
   */
  hasData: boolean;
  buckets: SocialOrganicAudienceBucket[];
};

const GENDER_LABELS: Readonly<Record<string, string>> = {
  f: 'Feminino',
  m: 'Masculino',
  u: 'Não informado',
  female: 'Feminino',
  male: 'Masculino',
  unknown: 'Não informado',
};

/**
 * A stored key rendered for a person.
 *
 * Unknown keys fall through to the key itself, capitalized where it reads as a
 * place name. A city or country key is already a proper noun in Meta's data and
 * needs no dictionary; inventing one would mean a list that goes stale the first
 * time an audience reaches a city nobody anticipated.
 */
export function describeAudienceKey(
  kind: SocialOrganicAudienceKind,
  key: string,
): string {
  if (kind === 'gender') return GENDER_LABELS[key] ?? key;

  if (kind === 'age_gender') {
    const [age, gender] = key.split('|');

    if (!age || !gender) return key;

    // Age is Meta's own bracket (`25-34`, `65+`) and needs no translation; only
    // the gender half has a word in it.
    return `${age} · ${GENDER_LABELS[gender] ?? gender}`;
  }

  // Age brackets are already legible. City and country keys are place names
  // stored lowercased, so they are title-cased back for display — the stored
  // key stays the join, and this is only how it reads.
  return kind === 'age' ? key : titleCase(key);
}

/**
 * Buckets in the order a chart should draw them.
 *
 * Age and the age/gender cross sort by key, so brackets stay in their natural
 * order and each age holds its genders together — the arrangement a grouped bar
 * chart needs, and one that does not move as the audience does. Cities,
 * countries and gender sort by value descending, which is what a ranked bar or a
 * pie wants, with the key as a tiebreak so equal values do not produce an order
 * that depends on Postgres's physical row order.
 */
export function sortAudienceBuckets(
  kind: SocialOrganicAudienceKind,
  buckets: SocialOrganicAudienceBucket[],
): SocialOrganicAudienceBucket[] {
  if (kind === 'age' || kind === 'age_gender') {
    return [...buckets].sort((left, right) =>
      left.key.localeCompare(right.key),
    );
  }

  return [...buckets].sort((left, right) => {
    const byValue = compareDecimal(right.value, left.value);

    return byValue !== 0 ? byValue : left.key.localeCompare(right.key);
  });
}

/** `são paulo, brazil` → `São Paulo, Brazil`. Display only. */
function titleCase(value: string): string {
  return value.replace(
    /(^|[\s,.-])(\p{L})/gu,
    (_match, prefix: string, letter: string) =>
      `${prefix}${letter.toUpperCase()}`,
  );
}

/**
 * Compares two `numeric` strings without turning either into a float.
 *
 * A follower count is `numeric(18,6)`; parsing it into a double to sort would
 * be wrong in exactly the cases where two buckets are close.
 */
function compareDecimal(left: string, right: string): number {
  const scale = (value: string): bigint => {
    const [whole, fraction = ''] = value.split('.');

    return BigInt(`${whole || '0'}${fraction.padEnd(6, '0').slice(0, 6)}`);
  };

  const difference = scale(left) - scale(right);

  return difference === 0n ? 0 : difference > 0n ? 1 : -1;
}
