import { SocialCopyGenerationStateMachine } from './social-copy-generation-state-machine';

describe('SocialCopyGenerationStateMachine', () => {
  const machine = new SocialCopyGenerationStateMachine();

  it('claims a queued run and lets it finish either way', () => {
    expect(machine.isLegalTransition('queued', 'processing', 0, 3)).toBe(true);
    expect(machine.isLegalTransition('processing', 'succeeded', 1, 3)).toBe(
      true,
    );
    expect(machine.isLegalTransition('processing', 'failed', 1, 3)).toBe(true);
  });

  it('never starts a run that was not queued', () => {
    expect(machine.isLegalTransition('succeeded', 'processing', 1, 3)).toBe(
      false,
    );
    expect(machine.isLegalTransition('cancelled', 'processing', 1, 3)).toBe(
      false,
    );
    expect(machine.isLegalTransition('dead_letter', 'processing', 3, 3)).toBe(
      false,
    );
  });

  /**
   * The operator must be able to stop a run that is already talking to the
   * provider. Refusing this transition would leave a spinner nobody can cancel.
   */
  it('allows cancelling from queued and from processing', () => {
    expect(machine.isLegalTransition('queued', 'cancelled', 0, 3)).toBe(true);
    expect(machine.isLegalTransition('processing', 'cancelled', 1, 3)).toBe(
      true,
    );
  });

  it('retries a failure only while attempts remain', () => {
    expect(machine.isLegalTransition('failed', 'queued', 1, 3)).toBe(true);
    expect(machine.isLegalTransition('failed', 'queued', 3, 3)).toBe(false);
  });

  it('dead-letters only once attempts are spent', () => {
    expect(machine.isLegalTransition('failed', 'dead_letter', 3, 3)).toBe(true);
    expect(machine.isLegalTransition('failed', 'dead_letter', 1, 3)).toBe(
      false,
    );
  });

  it('treats succeeded, cancelled and dead_letter as terminal', () => {
    expect(machine.isTerminal('succeeded')).toBe(true);
    expect(machine.isTerminal('cancelled')).toBe(true);
    expect(machine.isTerminal('dead_letter')).toBe(true);
    expect(machine.isTerminal('queued')).toBe(false);
    expect(machine.isTerminal('processing')).toBe(false);
    expect(machine.isTerminal('failed')).toBe(false);
  });

  /**
   * A cancelled run must never be revived. If it could go back to `queued`, a
   * failing worker's retry would charge the operator for work they stopped.
   */
  it('refuses to revive a terminal run', () => {
    expect(machine.isLegalTransition('cancelled', 'queued', 1, 3)).toBe(false);
    expect(machine.isLegalTransition('succeeded', 'failed', 1, 3)).toBe(false);
    expect(machine.isLegalTransition('dead_letter', 'queued', 3, 3)).toBe(
      false,
    );
  });

  it('throws on an illegal transition with both attempt counts named', () => {
    expect(() => machine.assertTransition('succeeded', 'queued', 2, 3)).toThrow(
      /succeeded -> queued \(attempts=2, maxAttempts=3\)/,
    );
  });
});
