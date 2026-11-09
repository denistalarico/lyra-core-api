import { TaskStatus } from '../projects/enums';

/** What one step tells its subtask: read from the owners, never a payload. */
export type WorkSignal = {
  status: string | null;
  isStale: boolean;
  finished: boolean;
};

export type DerivedSubtaskStatus =
  | 'in_progress'
  | 'in_review'
  | 'approved'
  | 'done';

type SignalState = 'hold' | 'pending' | 'changes' | 'review' | 'approved';

function stateOf(signal: WorkSignal): SignalState {
  if (signal.finished) return 'approved';
  switch (signal.status) {
    case 'awaiting_internal_review':
    case 'awaiting_client':
      return 'review';
    case 'changes_requested':
      return 'changes';
    case 'approved':
      // D-20: approved and then altered counts as not approved.
      return signal.isStale ? 'pending' : 'approved';
    case 'cancelled':
    case 'superseded':
      return 'hold';
    default:
      return 'pending';
  }
}

/**
 * D-26 — the status a subtask takes from its steps. `null` means leave it as
 * it is: a cancelled or superseded round says nothing about the work, and a
 * subtask nothing was ever sent from has no decision to reflect.
 *
 * A step not sent yet is the latest possible state, so a subtask with a copy
 * approved and a creative still to send stays in progress instead of reading
 * as approved.
 */
export function deriveSubtaskStatus(
  signals: readonly WorkSignal[],
): DerivedSubtaskStatus | null {
  if (signals.length === 0) return null;
  if (signals.every((signal) => signal.finished)) return 'done';
  const states = signals.map(stateOf);
  if (states.includes('hold')) return null;
  if (states.every((state) => state === 'pending')) return null;
  if (states.includes('changes') || states.includes('pending'))
    return 'in_progress';
  if (states.includes('review')) return 'in_review';
  return 'approved';
}

const SETTLED_SUBTASK = new Set(['approved', 'done']);

/**
 * D-26 — the parent follows its subtasks. `done` needs a finished piece, since
 * otherwise it stays a human decision, and only a task the observer can have
 * approved goes back to work.
 */
export function deriveParentTaskStatus(
  subtaskStatuses: readonly string[],
  current: TaskStatus,
  finalized: boolean,
): TaskStatus | null {
  const live = subtaskStatuses.filter((status) => status !== 'cancelled');
  if (live.length === 0) return null;
  if (finalized && live.every((status) => status === 'done'))
    return TaskStatus.Done;
  if (live.every((status) => SETTLED_SUBTASK.has(status)))
    return TaskStatus.Approved;
  return current === TaskStatus.Approved ? TaskStatus.InProgress : null;
}
