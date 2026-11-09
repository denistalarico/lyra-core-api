import { TaskStatus } from '../projects/enums';
import {
  deriveParentTaskStatus,
  deriveSubtaskStatus,
  type WorkSignal,
} from './work-status.derivation';

const signal = (
  status: string | null,
  extra: Partial<WorkSignal> = {},
): WorkSignal => ({ status, isStale: false, finished: false, ...extra });

describe('deriveSubtaskStatus (D-26)', () => {
  it.each([
    ['awaiting_internal_review', 'in_review'],
    ['awaiting_client', 'in_review'],
    ['changes_requested', 'in_progress'],
    ['approved', 'approved'],
  ])('maps %s to %s', (status, expected) => {
    expect(deriveSubtaskStatus([signal(status)])).toBe(expected);
  });

  it.each(['cancelled', 'superseded'])('leaves the subtask on %s', (status) => {
    expect(deriveSubtaskStatus([signal(status)])).toBeNull();
    expect(
      deriveSubtaskStatus([signal(status), signal('approved')]),
    ).toBeNull();
  });

  it('says nothing when nothing was ever sent', () => {
    expect(deriveSubtaskStatus([])).toBeNull();
    expect(deriveSubtaskStatus([signal(null), signal('draft')])).toBeNull();
  });

  it('takes the most delayed state of several items', () => {
    expect(
      deriveSubtaskStatus([signal('approved'), signal('awaiting_client')]),
    ).toBe('in_review');
    expect(
      deriveSubtaskStatus([
        signal('awaiting_client'),
        signal('changes_requested'),
      ]),
    ).toBe('in_progress');
  });

  it('does not read as approved while a delivery was not sent', () => {
    expect(deriveSubtaskStatus([signal('approved'), signal(null)])).toBe(
      'in_progress',
    );
  });

  it('counts an approval altered afterwards as not approved (D-20)', () => {
    expect(deriveSubtaskStatus([signal('approved', { isStale: true })])).toBe(
      null,
    );
    expect(
      deriveSubtaskStatus([
        signal('approved', { isStale: true }),
        signal('approved'),
      ]),
    ).toBe('in_progress');
  });

  it('marks done only when every piece was finished', () => {
    expect(
      deriveSubtaskStatus([
        signal('approved', { finished: true }),
        signal(null, { finished: true }),
      ]),
    ).toBe('done');
    expect(
      deriveSubtaskStatus([
        signal('approved', { finished: true }),
        signal('awaiting_client'),
      ]),
    ).toBe('in_review');
  });
});

describe('deriveParentTaskStatus (D-26)', () => {
  it('approves when every subtask is approved, ignoring cancelled ones', () => {
    expect(
      deriveParentTaskStatus(
        ['approved', 'cancelled', 'approved'],
        TaskStatus.InProgress,
        false,
      ),
    ).toBe(TaskStatus.Approved);
  });

  it('keeps done as a human decision unless a piece was finished', () => {
    expect(
      deriveParentTaskStatus(['done', 'done'], TaskStatus.InProgress, false),
    ).toBe(TaskStatus.Approved);
    expect(
      deriveParentTaskStatus(['done', 'done'], TaskStatus.InProgress, true),
    ).toBe(TaskStatus.Done);
  });

  it('returns an approved task to work when a subtask reopens', () => {
    expect(
      deriveParentTaskStatus(
        ['approved', 'in_review'],
        TaskStatus.Approved,
        false,
      ),
    ).toBe(TaskStatus.InProgress);
  });

  it('otherwise leaves the task alone', () => {
    expect(
      deriveParentTaskStatus(['in_review'], TaskStatus.Todo, false),
    ).toBeNull();
    expect(deriveParentTaskStatus([], TaskStatus.Approved, false)).toBeNull();
    expect(
      deriveParentTaskStatus(['cancelled'], TaskStatus.Approved, false),
    ).toBeNull();
  });
});
