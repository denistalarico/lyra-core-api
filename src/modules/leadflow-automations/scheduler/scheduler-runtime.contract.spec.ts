import {
  SCHEDULER_RUNTIME,
  type CancelTimerRequest,
  type ScheduleTimerRequest,
  type ScheduledTimerHandle,
  type SchedulerRuntime,
} from './scheduler-runtime.contract';

/**
 * Phase 0 ships the SchedulerRuntime as a contract only — no engine yet. These
 * tests pin the shape of that contract so a later Postgres (or Temporal)
 * implementation has something to conform to, and prove the DI token is stable.
 *
 * The in-memory fake here is a test double, not the MVP implementation: it exists
 * only to demonstrate that the port's idempotency and cancel semantics are
 * expressible and to lock the method signatures.
 */
class InMemorySchedulerRuntimeFake implements SchedulerRuntime {
  private readonly timers = new Map<string, ScheduledTimerHandle>();
  private seq = 0;

  private key(scope: string | undefined, timerKey: string, ws: string): string {
    return `${ws}:${scope ?? '*'}:${timerKey}`;
  }

  schedule(request: ScheduleTimerRequest): Promise<ScheduledTimerHandle> {
    const key = this.key(request.dedupeScope, request.timerKey, request.workspaceId);
    const existing = this.timers.get(key);
    // Idempotent by timerKey within dedupeScope: a repeat returns the same handle.
    if (existing && existing.status === 'scheduled') {
      return Promise.resolve(existing);
    }
    const handle: ScheduledTimerHandle = {
      timerId: `timer_${++this.seq}`,
      timerKey: request.timerKey,
      status: 'scheduled',
      fireAt: request.fireAt,
    };
    this.timers.set(key, handle);
    return Promise.resolve(handle);
  }

  cancel(request: CancelTimerRequest): Promise<void> {
    const key = this.key(request.dedupeScope, request.timerKey, request.workspaceId);
    const existing = this.timers.get(key);
    if (existing) this.timers.set(key, { ...existing, status: 'cancelled' });
    return Promise.resolve();
  }

  reschedule(request: ScheduleTimerRequest): Promise<ScheduledTimerHandle> {
    const key = this.key(request.dedupeScope, request.timerKey, request.workspaceId);
    const previous = this.timers.get(key);
    if (previous) this.timers.set(key, { ...previous, status: 'superseded' });
    const handle: ScheduledTimerHandle = {
      timerId: `timer_${++this.seq}`,
      timerKey: request.timerKey,
      status: 'scheduled',
      fireAt: request.fireAt,
    };
    this.timers.set(key, handle);
    return Promise.resolve(handle);
  }
}

const baseRequest: ScheduleTimerRequest = {
  tenantId: 'tenant-1',
  workspaceId: 'ws-1',
  timerKey: 'followup:opp-1:24h',
  dedupeScope: 'automation-9',
  fireAt: '2026-07-25T12:00:00.000Z',
  purpose: 'automation_followup',
  consumerKey: 'leadflow.automations',
  payload: { opportunityId: 'opp-1' },
};

describe('SchedulerRuntime contract', () => {
  it('exposes a stable injection token', () => {
    expect(typeof SCHEDULER_RUNTIME).toBe('symbol');
  });

  it('is idempotent on timerKey within a dedupeScope', async () => {
    const scheduler = new InMemorySchedulerRuntimeFake();
    const first = await scheduler.schedule(baseRequest);
    const second = await scheduler.schedule(baseRequest);
    expect(second.timerId).toBe(first.timerId);
    expect(second.status).toBe('scheduled');
  });

  it('cancels a scheduled timer by key', async () => {
    const scheduler = new InMemorySchedulerRuntimeFake();
    await scheduler.schedule(baseRequest);
    await scheduler.cancel({
      tenantId: baseRequest.tenantId,
      workspaceId: baseRequest.workspaceId,
      timerKey: baseRequest.timerKey,
      dedupeScope: baseRequest.dedupeScope,
    });
    // Re-scheduling after cancel yields a fresh timer, not the cancelled one.
    const rescheduled = await scheduler.schedule(baseRequest);
    expect(rescheduled.status).toBe('scheduled');
  });

  it('supersedes the previous timer on reschedule', async () => {
    const scheduler = new InMemorySchedulerRuntimeFake();
    const original = await scheduler.schedule(baseRequest);
    const moved = await scheduler.reschedule({
      ...baseRequest,
      fireAt: '2026-07-26T12:00:00.000Z',
    });
    expect(moved.timerId).not.toBe(original.timerId);
    expect(moved.fireAt).toBe('2026-07-26T12:00:00.000Z');
  });
});
