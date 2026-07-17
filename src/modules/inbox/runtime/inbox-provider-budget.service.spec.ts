import {
  assertBudgetAvailable,
  estimateProviderCost,
} from './inbox-provider-budget.service';

const limits = {
  budgetUsd: 2,
  maxDecisionCalls: 20,
  maxTranscriptionCalls: 10,
  maxVisionCalls: 10,
  maxImageInputs: 10,
};

const pricing = {
  decisionInputUsdPerMillion: null,
  decisionCachedInputUsdPerMillion: null,
  decisionOutputUsdPerMillion: null,
  transcriptionUsdPerMinute: null,
};

describe('InboxProviderBudgetService contracts', () => {
  it('blocks a call before the configured aggregate budget is exceeded', () => {
    expect(() =>
      assertBudgetAvailable(
        {
          costUsd: 1.95,
          decisionCalls: 4,
          transcriptionCalls: 1,
          visionCalls: 0,
          imageInputs: 2,
        },
        limits,
        'decision',
        0.1,
        1,
      ),
    ).toThrow('provider_budget_exhausted');
  });

  it('enforces call and image ceilings independently from cost', () => {
    expect(() =>
      assertBudgetAvailable(
        {
          costUsd: 0.1,
          decisionCalls: 20,
          transcriptionCalls: 0,
          visionCalls: 0,
          imageInputs: 0,
        },
        limits,
        'decision',
        0.01,
        0,
      ),
    ).toThrow('provider_call_limit_exhausted');
    expect(() =>
      assertBudgetAvailable(
        {
          costUsd: 0.1,
          decisionCalls: 1,
          transcriptionCalls: 0,
          visionCalls: 0,
          imageInputs: 10,
        },
        limits,
        'decision',
        0.01,
        1,
      ),
    ).toThrow('provider_image_limit_exhausted');
  });

  it('uses the documented Terra and Luna rates with cached-token accounting', () => {
    const usage = {
      inputTokens: 1_000,
      cachedInputTokens: 400,
      outputTokens: 500,
    };
    const terra = estimateProviderCost(
      'decision',
      'gpt-5.6-terra',
      usage,
      0.1,
      pricing,
    );
    const luna = estimateProviderCost(
      'decision',
      'gpt-5.6-luna',
      usage,
      0.1,
      pricing,
    );
    expect(terra).toBe(0.0091);
    expect(luna).toBe(0.00364);
  });

  it('estimates gpt-4o-mini-transcribe at its documented per-minute rate', () => {
    expect(
      estimateProviderCost(
        'transcription',
        'gpt-4o-mini-transcribe',
        { audioSeconds: 30 },
        0.02,
        pricing,
      ),
    ).toBe(0.0015);
  });
});
