/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { PostgresSchedulerRuntime } from './postgres-scheduler-runtime.service';

describe('PostgresSchedulerRuntime', () => {
  it('returns the existing active timer for an idempotent schedule', async () => {
    const timer = row();
    const query = chain({ getOne: jest.fn().mockResolvedValue(timer) });
    const manager = {
      getRepository: jest.fn().mockReturnValue({
        createQueryBuilder: jest.fn().mockReturnValue(query),
      }),
    };
    const dataSource = {
      transaction: jest.fn((callback) => callback(manager)),
    };
    const runtime = new PostgresSchedulerRuntime(
      dataSource as never,
      { resolve: jest.fn() } as never,
    );

    const handle = await runtime.schedule(request());
    expect(handle).toMatchObject({
      timerId: 'timer-1',
      status: 'scheduled',
      fireAt: '2026-07-27T12:00:00.000Z',
    });
  });

  it('marks a timer fired only after its consumer succeeds', async () => {
    const timer = row({ status: 'processing', attempts: 1 });
    const claimBuilder = chain();
    const manager = {
      query: jest.fn().mockResolvedValue([{ id: timer.id }]),
      createQueryBuilder: jest.fn().mockReturnValue(claimBuilder),
    };
    const update = jest.fn().mockResolvedValue({ affected: 1 });
    const repository = {
      findOneBy: jest.fn().mockResolvedValue(timer),
      update,
    };
    const consumer = { handleTimer: jest.fn().mockResolvedValue(undefined) };
    const dataSource = {
      transaction: jest.fn((callback) => callback(manager)),
      getRepository: jest.fn().mockReturnValue(repository),
    };
    const runtime = new PostgresSchedulerRuntime(
      dataSource as never,
      { resolve: jest.fn().mockReturnValue(consumer) } as never,
    );

    expect(await runtime.processPending(1)).toBe(1);
    expect(consumer.handleTimer).toHaveBeenCalledWith(
      expect.objectContaining({
        timerId: 'timer-1',
        attempt: 1,
        tenantId: 'tenant-1',
      }),
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'timer-1' }),
      expect.objectContaining({ status: 'fired' }),
    );
  });

  it('returns a failed delivery to scheduled for retry', async () => {
    const timer = row({ status: 'processing', attempts: 1 });
    const manager = {
      query: jest.fn().mockResolvedValue([{ id: timer.id }]),
      createQueryBuilder: jest.fn().mockReturnValue(chain()),
    };
    const update = jest.fn().mockResolvedValue({ affected: 1 });
    const dataSource = {
      transaction: jest.fn((callback) => callback(manager)),
      getRepository: jest.fn().mockReturnValue({
        findOneBy: jest.fn().mockResolvedValue(timer),
        update,
      }),
    };
    const runtime = new PostgresSchedulerRuntime(
      dataSource as never,
      {
        resolve: jest.fn().mockReturnValue({
          handleTimer: jest.fn().mockRejectedValue(new Error('temporary')),
        }),
      } as never,
    );

    await runtime.processPending(1);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'timer-1' }),
      expect.objectContaining({
        status: 'scheduled',
        lastError: 'temporary',
      }),
    );
  });
});

function request() {
  return {
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    timerKey: 'followup-1',
    dedupeScope: 'automation-1',
    fireAt: '2026-07-27T12:00:00.000Z',
    purpose: 'automation_followup' as const,
    consumerKey: 'leadflow.automations.followup',
    payload: {},
  };
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'timer-1',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    timerKey: 'followup-1',
    dedupeScope: 'automation-1',
    fireAt: new Date('2026-07-27T12:00:00.000Z'),
    purpose: 'automation_followup',
    consumerKey: 'leadflow.automations.followup',
    payload: {},
    status: 'scheduled',
    attempts: 0,
    maxAttempts: 8,
    createdAt: new Date('2026-07-26T12:00:00.000Z'),
    ...overrides,
  };
}

function chain(extra: Record<string, jest.Mock> = {}) {
  const value: Record<string, jest.Mock> = {
    setLock: jest.fn(),
    where: jest.fn(),
    andWhere: jest.fn(),
    update: jest.fn(),
    set: jest.fn(),
    whereInIds: jest.fn(),
    execute: jest.fn().mockResolvedValue({ affected: 1 }),
    getOne: jest.fn().mockResolvedValue(null),
    ...extra,
  };
  for (const fn of Object.values(value)) {
    if (fn.getMockName() === 'jest.fn()' && !fn.getMockImplementation()) {
      fn.mockReturnValue(value);
    }
  }
  // All fluent methods except terminal calls return the same builder.
  for (const key of [
    'setLock',
    'where',
    'andWhere',
    'update',
    'set',
    'whereInIds',
  ]) {
    value[key].mockReturnValue(value);
  }
  return value;
}
