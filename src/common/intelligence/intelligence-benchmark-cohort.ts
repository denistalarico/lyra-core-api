/**
 * The cohort a contribution belongs to, and how it survives one varchar(80).
 *
 * `leadflow_product_telemetry_daily.dimension_key` is a single 80-character
 * column, and the I6 decisions rule out a migration. So the cohort's four axes
 * are encoded into that one string — but through *this* serializer and nothing
 * else. Ad-hoc concatenation at call sites was ruled out explicitly, and for a
 * reason worth stating: a string built in one place and parsed in another with
 * a slightly different separator produces a cohort that silently never matches,
 * which reads downstream as "no contributors" rather than as a bug.
 *
 * ## The encoding is closed, not free-form
 *
 * Every axis draws from a fixed vocabulary, and `parseBenchmarkCohortKey`
 * rejects anything outside it. That is not defensive tidiness — it is the §17
 * privacy control implemented in the type system. An attacker who could put an
 * arbitrary value in a cohort axis could construct a cohort matching exactly one
 * contributor and read that contributor's numbers out of a "benchmark". With a
 * closed vocabulary, the set of askable questions is finite, enumerable, and
 * fixed at deploy time; differencing has nothing to vary.
 *
 * ## What is deliberately NOT in here
 *
 * **The window.** Contributions are daily facts; the window is a property of the
 * projector that reads them. Encoding it would duplicate every contribution once
 * per window definition and make `trailing_30` and `previous_month` disagree
 * about the same day. §3 of the decisions says this directly.
 *
 * **Anything identifying.** No account, campaign, ad set, ad, conversation,
 * contact or user id. The only identity permitted anywhere near a fact row is
 * the existing `scope_pseudonym`.
 */

/** Version prefix. Bumped when the encoding changes, never reused. */
export const BENCHMARK_COHORT_VERSION = 'v1';

/** Hard ceiling from the storage column. */
export const BENCHMARK_COHORT_MAX_LENGTH = 80;

/**
 * ## The business-mode vocabulary is injected, not enumerated here
 *
 * There is no list of business modes in this file, and that is a rule the
 * contract already enforces (`intelligence-contract.boundary.spec`) for a reason
 * that applies with full force to benchmarking:
 * `leadflow_business_mode_templates` is **tenant-extensible**, so any list typed
 * into this folder is wrong for some tenant from the moment it is written.
 *
 * Eligibility is therefore parameterised. The caller — which lives in a module
 * allowed to read the catalog — supplies the set of system-defined keys, and
 * this file decides what to *do* with it. That keeps the semantic rule (only
 * system modes are cross-tenant comparable, never map custom onto official by
 * name) in the shared contract, while the data stays in the domain that owns it.
 *
 * The destination vocabulary below is a different case: it is a closed canonical
 * set defined in code, not a tenant-extensible table, so mirroring it costs
 * nothing that can drift per tenant. It is still kept in step with
 * `CanonicalPaidMediaDestination` by a spec inside `social-integrations`, which
 * is the module allowed to see both halves.
 */

/**
 * The canonical paid-media destinations, mirrored from the Social vocabulary.
 *
 * `unknown` is a *member*: a cohort of ad sets whose destination Meta never
 * stated is a real and comparable population, and dropping those contributions
 * would quietly bias the remaining cohorts toward advertisers who happen to run
 * newer campaign types.
 */
export const BENCHMARK_ELIGIBLE_DESTINATIONS: readonly string[] = [
  'whatsapp',
  'instagram_direct',
  'messenger',
  'messaging_multi',
  'website',
  'lead_form',
  'app',
  'phone',
  'profile',
  'on_post',
  'unknown',
];

/**
 * The destination axis, structurally identical to `CanonicalPaidMediaDestination`
 * and kept in step with it by a spec inside `social-integrations`.
 */
export type BenchmarkDestination =
  | 'whatsapp'
  | 'instagram_direct'
  | 'messenger'
  | 'messaging_multi'
  | 'website'
  | 'lead_form'
  | 'app'
  | 'phone'
  | 'profile'
  | 'on_post'
  | 'unknown';

const ELIGIBLE_DESTINATIONS: ReadonlySet<string> = new Set(
  BENCHMARK_ELIGIBLE_DESTINATIONS,
);

/** Providers with a contribution path today. */
const ELIGIBLE_PROVIDERS: ReadonlySet<string> = new Set(['meta']);

/**
 * ISO 4217 shape. The vocabulary is not enumerated — a currency is data, and a
 * closed list would drop a contributor the day Meta bills a new one — but the
 * *shape* is enforced so the axis cannot carry arbitrary text.
 */
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

/**
 * The system-defined mode keys, supplied by the module that owns the catalog.
 *
 * A `ReadonlySet` rather than an array because every use is a membership test,
 * and because a set makes it awkward to accidentally treat the vocabulary as an
 * ordered thing that could be indexed into.
 */
export type BenchmarkBusinessModeVocabulary = ReadonlySet<string>;

export type BenchmarkCohort = {
  businessModeKey: string;
  provider: string;
  destination: BenchmarkDestination;
  /**
   * Required for monetary metrics, null for counts.
   *
   * Nullable rather than always-present because a cohort of impressions split by
   * currency would fragment the sample for no reason — impressions are
   * impressions in every currency, and every split axis costs contributors
   * against k. Monetary metrics get the split because BRL and USD spend are not
   * comparable and there is no FX in this slice.
   */
  currency: string | null;
};

/**
 * Cohort → storage key.
 *
 * Short axis prefixes (`bm=`, `p=`, `d=`, `c=`) because 80 characters is a real
 * constraint: the longest legitimate key today is
 * `v1|bm=education_courses|p=meta|d=instagram_direct|c=BRL` at 54 characters,
 * leaving room for a longer future business mode without a re-encoding. The
 * assertion below is not decoration — it is what turns "we think it fits" into
 * a guarantee, and it throws at write time rather than letting PostgreSQL
 * truncate silently.
 */
export function serializeBenchmarkCohortKey(
  cohort: BenchmarkCohort,
  systemModes: BenchmarkBusinessModeVocabulary,
): string {
  assertEligibleCohort(cohort, systemModes);

  const parts = [
    BENCHMARK_COHORT_VERSION,
    `bm=${cohort.businessModeKey}`,
    `p=${cohort.provider}`,
    `d=${cohort.destination}`,
  ];

  if (cohort.currency) parts.push(`c=${cohort.currency}`);

  const key = parts.join('|');

  if (key.length > BENCHMARK_COHORT_MAX_LENGTH) {
    throw new Error(
      `Benchmark cohort key exceeds ${BENCHMARK_COHORT_MAX_LENGTH} characters: ${key.length}.`,
    );
  }

  return key;
}

/**
 * Storage key → cohort, or `null`.
 *
 * Returns null rather than throwing for an unparseable key, because one exists
 * in exactly one legitimate situation: a row written by a previous encoding
 * version that is still inside its retention window. That row must be *skipped*,
 * not allowed to take down a benchmark query for every other contributor. A
 * caller that wants the strict behaviour asserts on the null.
 *
 * Round-trips with `serializeBenchmarkCohortKey` for every eligible cohort —
 * asserted by spec, since an encoder and a decoder that disagree is the failure
 * mode this whole module exists to prevent.
 */
export function parseBenchmarkCohortKey(
  key: string,
  systemModes: BenchmarkBusinessModeVocabulary,
): BenchmarkCohort | null {
  const segments = key.split('|');

  if (segments.length < 4 || segments[0] !== BENCHMARK_COHORT_VERSION) {
    return null;
  }

  const fields = new Map<string, string>();

  for (const segment of segments.slice(1)) {
    const separator = segment.indexOf('=');
    if (separator <= 0) return null;
    const name = segment.slice(0, separator);
    // A repeated axis is a malformed key, not a last-one-wins merge: accepting
    // it would let two different strings denote one cohort.
    if (fields.has(name)) return null;
    fields.set(name, segment.slice(separator + 1));
  }

  const businessModeKey = fields.get('bm');
  const provider = fields.get('p');
  const destination = fields.get('d');
  const currency = fields.get('c') ?? null;

  if (!businessModeKey || !provider || !destination) return null;
  if (fields.size !== (currency === null ? 3 : 4)) return null;

  const cohort: BenchmarkCohort = {
    businessModeKey,
    provider,
    destination: destination as BenchmarkDestination,
    currency,
  };

  try {
    assertEligibleCohort(cohort, systemModes);
  } catch {
    return null;
  }

  return cohort;
}

/**
 * Whether this cohort may take part in a cross-tenant benchmark at all.
 *
 * Separate from parsing so a caller holding a *candidate* cohort — a context
 * whose business mode is custom, unknown or unconfigured — can ask without
 * catching an exception. This is the §4 eligibility rule, in one place:
 *
 * - recognised system mode → eligible
 * - tenant-custom → not eligible
 * - unknown key → not eligible
 * - unconfigured (null) → not eligible
 */
export function isBenchmarkEligibleBusinessMode(
  key: string | null | undefined,
  systemModes: BenchmarkBusinessModeVocabulary,
): boolean {
  return typeof key === 'string' && key.length > 0 && systemModes.has(key);
}

function assertEligibleCohort(
  cohort: BenchmarkCohort,
  systemModes: BenchmarkBusinessModeVocabulary,
): void {
  if (!isBenchmarkEligibleBusinessMode(cohort.businessModeKey, systemModes)) {
    throw new Error(
      `Business mode "${cohort.businessModeKey}" is not eligible for a cross-tenant cohort.`,
    );
  }

  if (!ELIGIBLE_PROVIDERS.has(cohort.provider)) {
    throw new Error(
      `Provider "${cohort.provider}" is not a benchmark provider.`,
    );
  }

  if (!ELIGIBLE_DESTINATIONS.has(cohort.destination)) {
    throw new Error(
      `Destination "${cohort.destination}" is not a canonical paid-media destination.`,
    );
  }

  if (cohort.currency !== null && !CURRENCY_PATTERN.test(cohort.currency)) {
    throw new Error(
      `Currency "${cohort.currency}" is not an ISO 4217 alphabetic code.`,
    );
  }
}
