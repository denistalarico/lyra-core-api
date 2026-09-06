/**
 * Identity and versioning for the rules that produce a recommendation.
 *
 * ## The problem this solves
 *
 * A recommendation is an argument: *given these thresholds, this observation
 * justifies this proposal*. Persisting the observation (R2's evidence) and the
 * proposal while leaving the thresholds in a mutable TypeScript constant means
 * the argument's middle term is read from whatever the code says *today*. Lower
 * a threshold next quarter and every stored recommendation silently becomes a
 * claim nobody made: the row still says "the failure rate exceeded the policy
 * limit", and the limit it exceeded is no longer knowable.
 *
 * That is not a display bug. An approved recommendation is an audit record of
 * why a human changed production configuration, and it has to stay legible
 * after the rules move.
 *
 * ## The three things kept apart
 *
 * These are routinely conflated and are not the same:
 *
 * - **kind** — what is being proposed (`pause_automation_high_failure_rate`).
 *   Owned by the domain; determines the target, the config shape, the applier.
 * - **policy identity** — which body of rules decided it
 *   (`automation_failure_pause`). Stable across versions, so every
 *   recommendation ever produced by these rules can be found together.
 * - **policy version** — which revision of those rules ran (`1`). Changes
 *   whenever a threshold, formula, or selection rule changes.
 *
 * A kind may one day be served by more than one policy, and a policy will
 * certainly outlive several versions of itself. Collapsing any pair of these
 * into a single string forecloses both.
 */

/**
 * A policy's stable identity, independent of any revision of its rules.
 *
 * Deliberately *not* suffixed with a version. The existing constant's key is
 * `automation_failure_pause_v1`, which conflates identity with version in one
 * string — workable while there is one version, and unqueryable the moment
 * there are two: "every recommendation this policy ever made" becomes a LIKE
 * against a naming convention rather than an equality against a column.
 *
 * The suffixed string is preserved as the generation key prefix, where it is
 * load-bearing for idempotency; see `IntelligenceRecommendationPolicyDefinition.generationKeyPrefix`.
 */
export type IntelligenceRecommendationPolicyKey = string;

/**
 * Which revision of a policy's rules ran.
 *
 * An integer rather than a semver string or a date. A recommendation only ever
 * needs to answer "were these the same rules?" and "which came first?", and an
 * integer answers both without inviting a debate about what a minor version of
 * a threshold change would mean. It is also directly comparable in SQL, which a
 * dotted string is not.
 *
 * Versions are append-only by construction: a published version's parameters
 * are frozen (see `IntelligenceRecommendationPolicySnapshot`), and a rule change
 * is a new version, never an edit to an existing one.
 */
export type IntelligenceRecommendationPolicyVersion = number;

/**
 * The effective parameters a generation actually used.
 *
 * A flat bag of scalars on purpose. It is persisted as JSONB and read back by
 * code that may be many versions removed from the policy that wrote it, so it
 * has to be interpretable without the originating type — which is exactly the
 * property a strongly-typed-per-policy shape would destroy the first time a
 * parameter was renamed.
 *
 * Scalars only: a parameter that needs nesting is a sign the policy is carrying
 * configuration that belongs somewhere else.
 */
export type IntelligenceRecommendationPolicySnapshot = Record<
  string,
  number | string | boolean | null
>;

/**
 * The stamp a generation leaves on the recommendation it produces.
 *
 * The three fields travel together and are meaningless apart: a version without
 * a key does not say which rules, a key without a snapshot does not say which
 * thresholds, and a snapshot without either cannot be compared to a later one.
 */
export type IntelligenceRecommendationPolicyRef = {
  key: IntelligenceRecommendationPolicyKey;
  version: IntelligenceRecommendationPolicyVersion;
  /**
   * The values in force at generation time.
   *
   * Frozen at the moment of generation and never recomputed on read. This is
   * the field that makes a historical recommendation self-describing, and the
   * reason `list()` must not reach for the current definition when serialising
   * a stored row.
   */
  parameters: IntelligenceRecommendationPolicySnapshot;
};

/**
 * A policy as the code declares it.
 *
 * The registry entry: what a resolver returns and a generator reads. Kept
 * deliberately thin — identity, version, the kind it serves, and its
 * parameters. Execution concerns (who may approve, whether the action is
 * reversible, whether it touches money) are real and are *not* here, because
 * this slice is about auditability and a definition that grew an approval
 * policy would quietly become the place execution safety lives.
 */
export type IntelligenceRecommendationPolicyDefinition<
  TKind extends string = string,
  TParameters extends IntelligenceRecommendationPolicySnapshot =
    IntelligenceRecommendationPolicySnapshot,
> = {
  key: IntelligenceRecommendationPolicyKey;
  version: IntelligenceRecommendationPolicyVersion;

  /** The recommendation this policy produces. One kind per definition. */
  recommendationKind: TKind;

  /**
   * The thresholds and switches this version applies.
   *
   * The single source the evaluator reads. A generator that reaches past this
   * for a hardcoded number reintroduces exactly the drift the snapshot exists
   * to prevent, and the snapshot would then be a record of values that were not
   * used — worse than no snapshot at all.
   */
  parameters: TParameters;

  /**
   * The literal prefix that opens this policy's generation keys.
   *
   * Separate from `key` because idempotency is a *persisted* contract: a stored
   * recommendation's `generation_key` is matched against a freshly built string
   * to decide whether to insert, and changing how that string is built would
   * make every historical key unmatchable — the same recommendation would be
   * generated a second time.
   *
   * So the legacy suffixed identifier (`automation_failure_pause_v1`) stays
   * here verbatim, doing the one job it is still correct for, while `key` and
   * `version` carry the identity the rest of the system reasons about. The two
   * are allowed to disagree, and this field is where that is declared rather
   * than inferred.
   */
  generationKeyPrefix: string;
};

/**
 * Freeze a definition's parameters into the stamp a recommendation stores.
 *
 * The copy is the point. Handing the definition's own `parameters` object to a
 * persisted row would mean a single mutable object shared by the registry and
 * every recommendation built from it in that process — and an in-memory edit to
 * the registry would retroactively alter rows already built but not yet
 * flushed. Shallow is sufficient because the snapshot type admits only scalars.
 */
export function toPolicyRef(
  definition: IntelligenceRecommendationPolicyDefinition,
): IntelligenceRecommendationPolicyRef {
  return {
    key: definition.key,
    version: definition.version,
    parameters: { ...definition.parameters },
  };
}

/**
 * Whether two stamps came from the same rules.
 *
 * Identity *and* version: a comparison on key alone would call v1 and v2 the
 * same policy, which is true of the policy and false of the rules, and it is
 * the rules a reader is asking about.
 */
export function isSamePolicyVersion(
  left: Pick<IntelligenceRecommendationPolicyRef, 'key' | 'version'>,
  right: Pick<IntelligenceRecommendationPolicyRef, 'key' | 'version'>,
): boolean {
  return left.key === right.key && left.version === right.version;
}

/**
 * Read one parameter out of a stored snapshot.
 *
 * Snapshots come back from JSONB as `unknown`-shaped data written by a possibly
 * older version of the code, so a parameter this version expects may be absent
 * or may be a different type than it is today. Both cases are answered with the
 * caller's fallback rather than a throw: a historical recommendation that
 * cannot report one threshold is still a valid record of the rest, and failing
 * to render it would lose more than it protects.
 */
export function policyParameterNumber(
  snapshot: IntelligenceRecommendationPolicySnapshot | null | undefined,
  key: string,
  fallback: number,
): number {
  const value = snapshot?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
