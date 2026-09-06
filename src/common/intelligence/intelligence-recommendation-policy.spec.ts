import {
  isSamePolicyVersion,
  policyParameterNumber,
  toPolicyRef,
  type IntelligenceRecommendationPolicyDefinition,
} from './intelligence-recommendation-policy';

const V1: IntelligenceRecommendationPolicyDefinition = {
  key: 'automation_failure_pause',
  version: 1,
  recommendationKind: 'pause_automation_high_failure_rate',
  generationKeyPrefix: 'automation_failure_pause_v1',
  parameters: {
    minimumTerminalLiveRuns: 5,
    minimumFailedRuns: 2,
    minimumFailureRate: 0.3,
    appliesAutomatically: false,
  },
};

/**
 * A hypothetical successor, used only to prove the model holds a stricter
 * threshold apart from the one v1 applied. Nothing in production declares it —
 * a second real policy version would be a behaviour change, and this slice is
 * about being able to record one, not about making one.
 */
const V2: IntelligenceRecommendationPolicyDefinition = {
  ...V1,
  version: 2,
  parameters: { ...V1.parameters, minimumFailureRate: 0.4 },
};

describe('recommendation policy identity', () => {
  it('separates stable identity from the revision of the rules', () => {
    // The same body of rules across both versions...
    expect(V1.key).toBe(V2.key);
    // ...and the identity carries no version suffix, so "everything this policy
    // ever decided" is an equality rather than a LIKE against a convention.
    expect(V1.key).not.toContain('_v');
    expect(V1.version).not.toBe(V2.version);
  });

  it('keeps the generation key prefix separate from the identity', () => {
    // They differ, and that is the point: the suffixed literal is a persisted
    // idempotency contract, the key is what the system reasons about.
    expect(V1.generationKeyPrefix).toBe('automation_failure_pause_v1');
    expect(V1.generationKeyPrefix).not.toBe(V1.key);
  });

  it('treats two versions of one policy as different rules', () => {
    expect(isSamePolicyVersion(V1, V1)).toBe(true);
    expect(isSamePolicyVersion(V1, V2)).toBe(false);
    // Key alone would call these the same, which is true of the policy and
    // false of the rules — and it is the rules a reader is asking about.
    expect(V1.key === V2.key).toBe(true);
  });
});

describe('policy snapshot', () => {
  /**
   * The property the whole slice exists for.
   *
   * A recommendation stamped under v1 must keep reporting v1's threshold after
   * v2 becomes current. Proven against the model rather than against a real
   * second production policy, which would be an artificial behaviour change.
   */
  it('preserves the threshold a historical recommendation was judged against', () => {
    const stampedUnderV1 = toPolicyRef(V1);

    // v2 is now the policy in force.
    const current = toPolicyRef(V2);
    expect(current.parameters.minimumFailureRate).toBe(0.4);

    // The historical stamp is untouched by that.
    expect(stampedUnderV1.version).toBe(1);
    expect(stampedUnderV1.parameters.minimumFailureRate).toBe(0.3);
  });

  /**
   * Sharing the definition's own object would make every recommendation built
   * in a process hold a reference to one mutable bag — and an edit to the
   * registry would retroactively rewrite rows already built.
   */
  it('copies the parameters instead of aliasing the definition', () => {
    const ref = toPolicyRef(V1);

    expect(ref.parameters).not.toBe(V1.parameters);
    expect(ref.parameters).toEqual(V1.parameters);

    ref.parameters.minimumFailureRate = 0.9;
    expect(V1.parameters.minimumFailureRate).toBe(0.3);
  });

  it('survives a JSONB round trip', () => {
    const ref = toPolicyRef(V1);

    expect(JSON.parse(JSON.stringify(ref))).toEqual(ref);
  });

  /**
   * Snapshots are read back from JSONB written by possibly older code, so a
   * parameter this version expects may be missing or of another type. Both
   * answer with the fallback: a historical row that cannot report one threshold
   * is still a valid record of the rest.
   */
  it('reads a parameter defensively rather than throwing on old rows', () => {
    const snapshot = toPolicyRef(V1).parameters;

    expect(policyParameterNumber(snapshot, 'minimumFailureRate', 0)).toBe(0.3);
    expect(policyParameterNumber(snapshot, 'notRecorded', 0.3)).toBe(0.3);
    // A boolean parameter is not a number, and must not be coerced into one.
    expect(policyParameterNumber(snapshot, 'appliesAutomatically', -1)).toBe(
      -1,
    );
    expect(policyParameterNumber({}, 'minimumFailureRate', -1)).toBe(-1);
    expect(policyParameterNumber(null, 'minimumFailureRate', -1)).toBe(-1);
    expect(policyParameterNumber(undefined, 'minimumFailureRate', -1)).toBe(-1);
  });
});
