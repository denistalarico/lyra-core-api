import {
  LEAD_SCORE_POLICY_V1,
  LEAD_SCORE_POLICY_VERSION_V1,
} from '../policy/lead-score-rules-v1.policy';
import {
  LeadScoreFeatureKey,
  LeadScoreRuleId,
  maxAchievableScore,
  type LeadScoreFeature,
  type LeadScoreFeatureSet,
  type LeadScorePolicy,
} from '../lead-score.types';
import { calculateLeadScore } from './lead-score-calculator';

const AT = new Date('2026-07-23T12:00:00Z');

function value(v: number | boolean | string): LeadScoreFeature {
  return { available: true, value: v, observedAt: AT.toISOString() };
}

/** Everything an active rule needs, with a lead that satisfies nothing. */
function baseFeatures(
  overrides: LeadScoreFeatureSet = {},
): LeadScoreFeatureSet {
  return {
    [LeadScoreFeatureKey.OriginatedFromChannel]: value(false),
    [LeadScoreFeatureKey.ConversationLinked]: value(false),
    [LeadScoreFeatureKey.InboundMessageCount]: value(0),
    [LeadScoreFeatureKey.EssentialFieldsTotal]: value(2),
    [LeadScoreFeatureKey.EssentialFieldsPresent]: value(0),
    [LeadScoreFeatureKey.LifecycleStatus]: value('open'),
    [LeadScoreFeatureKey.StageIsLost]: value(false),
    ...overrides,
  };
}

/** A lead that satisfies every active rule. */
function perfectFeatures(): LeadScoreFeatureSet {
  return baseFeatures({
    [LeadScoreFeatureKey.OriginatedFromChannel]: value(true),
    [LeadScoreFeatureKey.InboundMessageCount]: value(5),
    [LeadScoreFeatureKey.EssentialFieldsPresent]: value(2),
  });
}

const entryFor = (
  result: ReturnType<typeof calculateLeadScore>,
  ruleId: LeadScoreRuleId,
) => result.breakdown.find((item) => item.ruleId === ruleId);

describe('calculateLeadScore', () => {
  const policy = LEAD_SCORE_POLICY_V1;

  it('is deterministic for the same features', () => {
    const a = calculateLeadScore(policy, perfectFeatures(), AT);
    const b = calculateLeadScore(policy, perfectFeatures(), AT);

    expect(a.score).toBe(b.score);
    expect(a.breakdown).toEqual(b.breakdown);
  });

  it('scores a lead that satisfies every active rule at the achievable maximum', () => {
    const result = calculateLeadScore(policy, perfectFeatures(), AT);

    expect(result.score).toBe(maxAchievableScore(policy));
    expect(result.score).toBe(45);
  });

  it('reports the achievable maximum so a cold band can be interpreted', () => {
    // 45 is the ceiling today, so `hot` is unreachable. A reader must be able
    // to tell that from the record rather than concluding every lead is cold.
    const result = calculateLeadScore(policy, perfectFeatures(), AT);

    expect(result.maxAchievable).toBe(45);
    expect(result.band).toBe('warm');
  });

  describe('bands', () => {
    const bandOf = (score: number) => {
      const stub: LeadScorePolicy = {
        ...policy,
        rules: [
          {
            id: LeadScoreRuleId.ChannelOrigin,
            label: 'stub',
            points: score,
            kind: 'contribution',
            availability: 'active',
            group: 'profile',
            owningDomain: 'test',
            features: [LeadScoreFeatureKey.OriginatedFromChannel],
          },
        ],
      };
      return calculateLeadScore(
        stub,
        { [LeadScoreFeatureKey.OriginatedFromChannel]: value(true) },
        AT,
      ).band;
    };

    it('classifies cold, warm and hot at the documented boundaries', () => {
      expect(bandOf(0)).toBe('cold');
      expect(bandOf(29)).toBe('cold');
      expect(bandOf(30)).toBe('warm');
      expect(bandOf(69)).toBe('warm');
      expect(bandOf(70)).toBe('hot');
      expect(bandOf(100)).toBe('hot');
    });

    it('clamps above the maximum and below the minimum', () => {
      expect(bandOf(500)).toBe('hot');
      expect(
        calculateLeadScore(
          {
            ...policy,
            rules: [
              {
                id: LeadScoreRuleId.FollowupUnanswered,
                label: 'stub',
                points: -500,
                kind: 'contribution',
                availability: 'active',
                group: 'penalty',
                owningDomain: 'test',
                features: [],
              },
            ],
          },
          {},
          AT,
        ).score,
      ).toBe(0);
    });
  });

  describe('terminal overrides', () => {
    it('zeroes a lost opportunity regardless of what it had achieved', () => {
      const result = calculateLeadScore(
        policy,
        baseFeatures({
          [LeadScoreFeatureKey.OriginatedFromChannel]: value(true),
          [LeadScoreFeatureKey.InboundMessageCount]: value(9),
          [LeadScoreFeatureKey.EssentialFieldsPresent]: value(2),
          [LeadScoreFeatureKey.LifecycleStatus]: value('lost'),
        }),
        AT,
      );

      expect(result.score).toBe(0);
      expect(result.terminalOverride).toBe(LeadScoreRuleId.LostOrDiscarded);
    });

    it('still records what the lead had achieved before being written off', () => {
      const result = calculateLeadScore(
        policy,
        baseFeatures({
          [LeadScoreFeatureKey.InboundMessageCount]: value(9),
          [LeadScoreFeatureKey.StageIsLost]: value(true),
        }),
        AT,
      );

      expect(entryFor(result, LeadScoreRuleId.LeadReplied)?.outcome).toBe(
        'contributed',
      );
      expect(result.score).toBe(0);
    });

    it('treats a lost stage as terminal even when the status still says open', () => {
      const result = calculateLeadScore(
        policy,
        baseFeatures({ [LeadScoreFeatureKey.StageIsLost]: value(true) }),
        AT,
      );

      expect(result.terminalOverride).toBe(LeadScoreRuleId.LostOrDiscarded);
    });
  });

  describe('rules without a source', () => {
    it('never lets a planned rule score', () => {
      const result = calculateLeadScore(policy, perfectFeatures(), AT);

      const planned = result.breakdown.filter(
        (entry) => entry.outcome === 'planned',
      );
      expect(planned.length).toBeGreaterThan(0);
      expect(planned.every((entry) => entry.appliedPoints === 0)).toBe(true);
    });

    it('distinguishes planned from not met', () => {
      // "Nobody built this" and "we checked and the answer is no" must not be
      // the same row in the breakdown.
      const result = calculateLeadScore(policy, baseFeatures(), AT);

      expect(entryFor(result, LeadScoreRuleId.CommercialIntent)?.outcome).toBe(
        'planned',
      );
      expect(entryFor(result, LeadScoreRuleId.LeadReplied)?.outcome).toBe(
        'not_met',
      );
    });

    it('reports not_applicable when the record has no link to the source', () => {
      const result = calculateLeadScore(
        policy,
        baseFeatures({
          [LeadScoreFeatureKey.InboundMessageCount]: {
            available: false,
            reason: 'no_canonical_link',
          },
        }),
        AT,
      );

      expect(entryFor(result, LeadScoreRuleId.LeadReplied)?.outcome).toBe(
        'not_applicable',
      );
    });

    it('reports unavailable when a source that should exist did not answer', () => {
      const result = calculateLeadScore(
        policy,
        baseFeatures({
          [LeadScoreFeatureKey.EssentialFieldsTotal]: {
            available: false,
            reason: 'business_mode_unresolved',
          },
        }),
        AT,
      );

      const entry = entryFor(result, LeadScoreRuleId.QualificationFields);
      expect(entry?.outcome).toBe('unavailable');
      expect(entry?.reasonCode).toBe('business_mode_unresolved');
      expect(entry?.appliedPoints).toBe(0);
    });

    it('does not certify qualification when no essential field was declared', () => {
      // Zero requirements met is not evidence that a lead is complete.
      const result = calculateLeadScore(
        policy,
        baseFeatures({
          [LeadScoreFeatureKey.EssentialFieldsTotal]: value(0),
          [LeadScoreFeatureKey.EssentialFieldsPresent]: value(0),
        }),
        AT,
      );

      const entry = entryFor(result, LeadScoreRuleId.QualificationFields);
      expect(entry?.outcome).toBe('not_applicable');
      expect(entry?.appliedPoints).toBe(0);
    });
  });

  describe('engagement', () => {
    it('awards the reply rule from one inbound message', () => {
      const result = calculateLeadScore(
        policy,
        baseFeatures({ [LeadScoreFeatureKey.InboundMessageCount]: value(1) }),
        AT,
      );

      expect(entryFor(result, LeadScoreRuleId.LeadReplied)?.outcome).toBe(
        'contributed',
      );
      expect(
        entryFor(result, LeadScoreRuleId.EngagedConversation)?.outcome,
      ).toBe('not_met');
      expect(result.score).toBe(15);
    });

    it('adds the engagement rule from three inbound messages', () => {
      const result = calculateLeadScore(
        policy,
        baseFeatures({ [LeadScoreFeatureKey.InboundMessageCount]: value(3) }),
        AT,
      );

      expect(result.score).toBe(25);
    });
  });

  it('does not accumulate when recalculated repeatedly', () => {
    // The engine recomputes the whole state; there is no incremental path that
    // could add the same points twice.
    const features = perfectFeatures();
    const first = calculateLeadScore(policy, features, AT);
    const second = calculateLeadScore(policy, features, AT);
    const third = calculateLeadScore(policy, features, AT);

    expect([first.score, second.score, third.score]).toEqual([45, 45, 45]);
  });

  it('stamps the policy and feature schema versions it used', () => {
    const result = calculateLeadScore(policy, perfectFeatures(), AT);

    expect(result.policyVersion).toBe(LEAD_SCORE_POLICY_VERSION_V1);
    expect(result.featureSchemaVersion).toBe('lead-score-features-v1');
  });

  it('records every rule of the policy, including the ones that cannot run', () => {
    // A rule quietly omitted would be indistinguishable from one that scored 0.
    const result = calculateLeadScore(policy, perfectFeatures(), AT);

    expect(result.breakdown).toHaveLength(policy.rules.length);
  });

  it('keeps no message content in the breakdown', () => {
    const result = calculateLeadScore(policy, perfectFeatures(), AT);

    for (const entry of result.breakdown) {
      for (const observed of Object.values(entry.observed)) {
        expect(typeof observed).not.toBe('undefined');
        if (typeof observed === 'string') {
          // Only short structured values such as a lifecycle status.
          expect(observed.length).toBeLessThanOrEqual(40);
        }
      }
    }
  });
});

describe('LEAD_SCORE_POLICY_V1', () => {
  it('explains every rule it cannot run', () => {
    for (const rule of LEAD_SCORE_POLICY_V1.rules) {
      if (rule.availability !== 'active') {
        expect(rule.blockedReason?.trim()).toBeTruthy();
      }
    }
  });

  it('names an owning domain for every rule', () => {
    for (const rule of LEAD_SCORE_POLICY_V1.rules) {
      expect(rule.owningDomain.trim()).not.toBe('');
    }
  });

  it('gives every active rule the features it needs', () => {
    for (const rule of LEAD_SCORE_POLICY_V1.rules) {
      if (rule.availability === 'active' && rule.kind === 'contribution') {
        expect(rule.features.length).toBeGreaterThan(0);
      }
    }
  });
});
