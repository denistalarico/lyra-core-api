import { LeadFlowBriefingJobStatus } from '../enums/leadflow-briefing-job-status.enum';
import { LeadFlowBriefingJobStateMachine } from './leadflow-briefing-job-state-machine';

const {
  Queued,
  Processing,
  Succeeded,
  Failed,
  Cancelled,
  DeadLetter,
} = LeadFlowBriefingJobStatus;

describe('LeadFlowBriefingJobStateMachine', () => {
  const machine = new LeadFlowBriefingJobStateMachine();

  it('allows queued -> processing -> succeeded', () => {
    expect(machine.isLegalTransition(Queued, Processing, 0, 5)).toBe(true);
    expect(machine.isLegalTransition(Processing, Succeeded, 1, 5)).toBe(true);
  });

  it('allows a retry (failed -> queued) while attempts remain', () => {
    expect(machine.isLegalTransition(Failed, Queued, 2, 5)).toBe(true);
  });

  it('forbids a retry once attempts are exhausted, requiring dead_letter instead', () => {
    expect(machine.isLegalTransition(Failed, Queued, 5, 5)).toBe(false);
    expect(machine.isLegalTransition(Failed, DeadLetter, 5, 5)).toBe(true);
  });

  it('forbids dead_letter while attempts remain', () => {
    expect(machine.isLegalTransition(Failed, DeadLetter, 2, 5)).toBe(false);
  });

  it('allows cancellation from queued or processing', () => {
    expect(machine.isLegalTransition(Queued, Cancelled, 0, 5)).toBe(true);
    expect(machine.isLegalTransition(Processing, Cancelled, 1, 5)).toBe(true);
  });

  it('treats succeeded, cancelled and dead_letter as terminal — no outgoing transition', () => {
    for (const terminal of [Succeeded, Cancelled, DeadLetter]) {
      expect(machine.isTerminal(terminal)).toBe(true);
      for (const to of [Queued, Processing, Succeeded, Failed, Cancelled, DeadLetter]) {
        expect(machine.isLegalTransition(terminal, to, 0, 5)).toBe(false);
      }
    }
  });

  it('forbids skipping straight from queued to succeeded', () => {
    expect(machine.isLegalTransition(Queued, Succeeded, 0, 5)).toBe(false);
  });

  it('assertTransition throws on an illegal transition and is silent on a legal one', () => {
    expect(() => machine.assertTransition(Succeeded, Queued, 0, 5)).toThrow();
    expect(() => machine.assertTransition(Queued, Processing, 0, 5)).not.toThrow();
  });
});
