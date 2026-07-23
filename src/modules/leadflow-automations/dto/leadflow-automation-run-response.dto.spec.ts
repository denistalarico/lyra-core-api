import type { LeadFlowAutomationRunEntity } from '../entities/leadflow-automation-run.entity';
import { mapRun } from './leadflow-automation-run-response.dto';

function run(
  overrides: Partial<LeadFlowAutomationRunEntity> = {},
): LeadFlowAutomationRunEntity {
  return {
    id: 'run-1',
    automationId: 'automation-1',
    automationVersionId: 'version-1',
    recipeKey: 'followup_idle_lead',
    templateVersion: 1,
    mode: 'shadow',
    status: 'skipped',
    skipReason: 'missing_context',
    triggerType: 'conversation.replied',
    triggerKind: 'event',
    sourceEventId: 'event-1',
    sourceEventName: 'leadflow.inbox.conversation.message.received',
    correlationId: null,
    inputSnapshot: {},
    result: {},
    errorCode: null,
    errorMessage: null,
    attemptCount: 0,
    scheduledAt: null,
    startedAt: new Date('2026-07-23T12:00:00Z'),
    finishedAt: new Date('2026-07-23T12:00:00Z'),
    createdAt: new Date('2026-07-23T12:00:00Z'),
    ...overrides,
  } as LeadFlowAutomationRunEntity;
}

describe('mapRun context measurement', () => {
  it('promotes the measured cost to a first-class field', () => {
    const mapped = mapRun(
      run({
        inputSnapshot: {
          verdictBasis: 'observed',
          contextSnapshot: {
            gaps: [],
            cost: {
              queryCount: 3,
              durationMs: 12,
              sources: [
                { source: 'inbox_message_reply', queryCount: 1, durationMs: 4 },
              ],
            },
          },
        },
      }),
    );

    expect(mapped.verdictBasis).toBe('observed');
    expect(mapped.contextGapCount).toBe(0);
    expect(mapped.contextCost).toEqual({
      queryCount: 3,
      durationMs: 12,
      sources: [
        { source: 'inbox_message_reply', queryCount: 1, durationMs: 4 },
      ],
    });
  });

  it('counts the gaps a partially assumed verdict carried', () => {
    const mapped = mapRun(
      run({
        inputSnapshot: {
          verdictBasis: 'partially_assumed',
          contextSnapshot: {
            gaps: [
              { signal: 'inside_business_hours', gap: 'missing_context' },
              { signal: 'lead_score', gap: 'missing_context' },
            ],
            cost: { queryCount: 1, durationMs: 5, sources: [] },
          },
        },
      }),
    );

    expect(mapped.verdictBasis).toBe('partially_assumed');
    expect(mapped.contextGapCount).toBe(2);
  });

  it('reports null cost for a run that carried no context snapshot', () => {
    // A dry-run may have no batched context. The absence is explicit, never a
    // fabricated zero-cost reading.
    const mapped = mapRun(
      run({ inputSnapshot: { blockedByDependency: false } }),
    );

    expect(mapped.contextCost).toBeNull();
    expect(mapped.verdictBasis).toBeNull();
    expect(mapped.contextGapCount).toBe(0);
  });
});
