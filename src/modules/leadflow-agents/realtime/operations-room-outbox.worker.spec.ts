import { RoomOutboxDeliveryState } from '../enums/room-operational.enums';
import {
  RoomAgentOperationalStatus,
  RoomOperationalSource,
} from '../enums/room-operational.enums';
import { OperationsRoomOutboxWorker } from './operations-room-outbox.worker';

describe('OperationsRoomOutboxWorker', () => {
  const row = {
    eventId: '11111111-1111-4111-8111-111111111111',
    contractVersion: 1,
    tenantId: '22222222-2222-4222-8222-222222222222',
    workspaceId: '33333333-3333-4333-8333-333333333333',
    roomVersion: '9',
    agentId: '44444444-4444-4444-8444-444444444444',
    agentRevision: '3',
    eventType: 'agent.status.changed',
    occurredAt: new Date('2026-07-16T12:00:00.000Z'),
    source: RoomOperationalSource.AgentRuntime,
    sourceEventId: 'runtime-9',
    correlationId: null,
    payload: {
      agentId: '44444444-4444-4444-8444-444444444444',
      status: RoomAgentOperationalStatus.Available,
      statusSince: '2026-07-16T12:00:00.000Z',
      source: RoomOperationalSource.AgentRuntime,
      reasonCode: null,
    },
    deliveryState: RoomOutboxDeliveryState.Processing,
    attemptCount: 1,
    nextAttemptAt: new Date(),
    claimedAt: new Date(),
    claimOwner: null,
    lastErrorCode: null,
    publishedAt: null,
    deadLetteredAt: null,
    createdAt: new Date('2026-07-16T11:59:59.000Z'),
  };

  it('claims a bounded ordered batch with SKIP LOCKED and a recoverable lease', async () => {
    const query = jest.fn().mockResolvedValue([[{ event_id: row.eventId }], 1]);
    const findBy = jest.fn().mockResolvedValue([row]);
    const worker = makeWorker({ query, findBy });

    const claimed = await privateWorker(worker).claimBatch();

    expect(claimed).toEqual([row]);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('FOR UPDATE SKIP LOCKED'),
      expect.arrayContaining([expect.stringMatching(/^worker-/), 30, 50]),
    );
    expect(query.mock.calls[0][0]).toContain("delivery_state = 'processing'");
    expect(query.mock.calls[0][0]).toContain('claimed_at <');
  });

  it('marks published only after the shared bus confirms publish', async () => {
    const update = jest.fn().mockResolvedValue({ affected: 1 });
    const bus = { publish: jest.fn().mockResolvedValue(undefined) };
    const metrics = metricsMock();
    const worker = makeWorker({ update, bus, metrics });

    await privateWorker(worker).publish(row);

    expect(bus.publish).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: row.eventId,
        deliveryState: RoomOutboxDeliveryState.Processing,
      }),
      expect.objectContaining({
        deliveryState: RoomOutboxDeliveryState.Published,
        publishedAt: expect.any(Date),
      }),
    );
    expect(metrics.published).toHaveBeenCalledTimes(1);
  });

  it('returns a temporary failure to pending with a sanitized error code', async () => {
    const update = jest.fn().mockResolvedValue({ affected: 1 });
    const bus = {
      publish: jest
        .fn()
        .mockRejectedValue(
          Object.assign(new Error('secret'), { code: 'ECONNRESET' }),
        ),
    };
    const metrics = metricsMock();
    const worker = makeWorker({ update, bus, metrics });

    await privateWorker(worker).publish({ ...row, attemptCount: 2 });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: row.eventId }),
      expect.objectContaining({
        deliveryState: RoomOutboxDeliveryState.Pending,
        nextAttemptAt: expect.any(Date),
        lastErrorCode: 'ECONNRESET',
      }),
    );
    expect(metrics.retried).toHaveBeenCalledTimes(1);
  });

  it('dead-letters poison events at the bounded attempt count', async () => {
    const update = jest.fn().mockResolvedValue({ affected: 1 });
    const metrics = metricsMock();
    const worker = makeWorker({
      update,
      bus: {
        publish: jest
          .fn()
          .mockRejectedValue(new Error('contains private detail')),
      },
      metrics,
    });

    await privateWorker(worker).publish({ ...row, attemptCount: 10 });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: row.eventId }),
      expect.objectContaining({
        deliveryState: RoomOutboxDeliveryState.DeadLetter,
        deadLetteredAt: expect.any(Date),
        lastErrorCode: 'publish_failed',
      }),
    );
    expect(metrics.deadLettered).toHaveBeenCalledTimes(1);
  });
});

function makeWorker(overrides: Record<string, unknown> = {}) {
  const dataSource = {
    query: jest.fn().mockResolvedValue([]),
    ...(overrides.query ? { query: overrides.query } : {}),
  };
  const repository = {
    findBy: jest.fn().mockResolvedValue([]),
    update: jest.fn().mockResolvedValue({ affected: 0 }),
    ...(overrides.findBy ? { findBy: overrides.findBy } : {}),
    ...(overrides.update ? { update: overrides.update } : {}),
  };
  return new OperationsRoomOutboxWorker(
    dataSource as never,
    repository as never,
    (overrides.bus ?? { publish: jest.fn() }) as never,
    (overrides.metrics ?? metricsMock()) as never,
  );
}

function metricsMock() {
  return {
    published: jest.fn(),
    retried: jest.fn(),
    deadLettered: jest.fn(),
    setBacklog: jest.fn(),
  };
}

function privateWorker(worker: OperationsRoomOutboxWorker) {
  return worker as unknown as {
    claimBatch(): Promise<Array<Record<string, unknown>>>;
    publish(value: Record<string, unknown>): Promise<void>;
  };
}
