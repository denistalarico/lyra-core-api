import { INBOX_AGENT_GOLDEN_CASES } from './agent-eval-golden-cases';

describe('Inbox Agent synthetic golden cases', () => {
  it('versions the twelve required PII-free activation scenarios', () => {
    expect(INBOX_AGENT_GOLDEN_CASES).toHaveLength(12);
    expect(new Set(INBOX_AGENT_GOLDEN_CASES.map((item) => item.id)).size).toBe(
      12,
    );
    expect(
      INBOX_AGENT_GOLDEN_CASES.every(
        (item) =>
          item.messages.length > 0 &&
          item.expected.forbiddenActionTypes.length > 0,
      ),
    ).toBe(true);
  });

  it('marks all security and side-effect-sensitive cases as critical', () => {
    const criticalIds = new Set(
      INBOX_AGENT_GOLDEN_CASES.filter((item) => item.critical).map(
        (item) => item.id,
      ),
    );
    for (const id of [
      'service-simple-lead',
      'burst-single-context',
      'audio-clear',
      'audio-inaudible',
      'image-relevant',
      'restaurant-reservation',
      'wrong-contact',
      'handoff-required',
      'prompt-injection',
      'invented-stage',
    ])
      expect(criticalIds.has(id)).toBe(true);
  });
});
