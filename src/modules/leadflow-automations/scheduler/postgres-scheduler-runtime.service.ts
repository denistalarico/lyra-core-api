import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { hostname } from 'node:os';
import { DataSource, EntityManager } from 'typeorm';
import { LeadFlowScheduledTimerEntity } from '../entities';
import type {
  CancelTimerRequest,
  ScheduleTimerRequest,
  ScheduledTimerHandle,
  SchedulerRuntime,
  TimerFireEnvelope,
} from './scheduler-runtime.contract';
import { ScheduledTimerConsumerRegistry } from './scheduled-timer-consumer.registry';

const DEFAULT_MAX_ATTEMPTS = 8;
const MAX_MAX_ATTEMPTS = 32;

/**
 * PostgreSQL-backed durable clock approved by decision D2.
 *
 * The claim/retry discipline mirrors the existing LeadFlow event ingress:
 * `FOR UPDATE SKIP LOCKED`, stale-lock recovery, exponential backoff and a
 * terminal dead-letter state. A timer is marked fired only after its named
 * consumer returns successfully, which gives at-least-once delivery.
 */
@Injectable()
export class PostgresSchedulerRuntime
  implements SchedulerRuntime, OnApplicationShutdown
{
  private readonly logger = new Logger(PostgresSchedulerRuntime.name);
  private readonly workerId = `${hostname()}:${process.pid}:leadflow-scheduler`;
  private running = false;
  private stopping = false;
  private metrics = {
    claimed: 0,
    fired: 0,
    failed: 0,
    deadLettered: 0,
    pruned: 0,
    lastLagMs: 0,
  };

  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
    private readonly consumers: ScheduledTimerConsumerRegistry,
  ) {}

  onApplicationShutdown(): void {
    this.stopping = true;
  }

  snapshot(): Readonly<typeof this.metrics> {
    return { ...this.metrics };
  }

  async schedule(request: ScheduleTimerRequest): Promise<ScheduledTimerHandle> {
    const normalized = normalizeRequest(request);
    try {
      return await this.dataSource.transaction(async (manager) => {
        const existing = await this.findActive(manager, normalized);
        if (existing) return toHandle(existing);
        const timer = manager
          .getRepository(LeadFlowScheduledTimerEntity)
          .create({
            tenantId: normalized.tenantId,
            workspaceId: normalized.workspaceId,
            timerKey: normalized.timerKey,
            dedupeScope: normalized.dedupeScope,
            fireAt: normalized.fireAt,
            purpose: normalized.purpose,
            consumerKey: normalized.consumerKey,
            payload: normalized.payload,
            status: 'scheduled',
            attempts: 0,
            maxAttempts: normalized.maxAttempts,
            availableAt: normalized.fireAt,
            lockedAt: null,
            lockedBy: null,
            firedAt: null,
            cancelledAt: null,
            supersededAt: null,
            deadLetteredAt: null,
            lastError: null,
            retainUntil: null,
          });
        return toHandle(await manager.save(timer));
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const existing = await this.dataSource
        .getRepository(LeadFlowScheduledTimerEntity)
        .createQueryBuilder('timer')
        .where('timer.tenant_id = :tenantId', normalized)
        .andWhere('timer.workspace_id = :workspaceId', normalized)
        .andWhere('timer.dedupe_scope = :dedupeScope', normalized)
        .andWhere('timer.timer_key = :timerKey', normalized)
        .andWhere("timer.status IN ('scheduled', 'processing')")
        .getOne();
      if (!existing) throw error;
      return toHandle(existing);
    }
  }

  async cancel(request: CancelTimerRequest): Promise<void> {
    const scope = normalizeScope(request);
    const now = new Date();
    await this.dataSource
      .createQueryBuilder()
      .update(LeadFlowScheduledTimerEntity)
      .set({
        status: 'cancelled',
        cancelledAt: now,
        lockedAt: null,
        lockedBy: null,
        retainUntil: addDays(now, 30),
        updatedAt: now,
      })
      .where('tenant_id = :tenantId', scope)
      .andWhere('workspace_id = :workspaceId', scope)
      .andWhere('dedupe_scope = :dedupeScope', scope)
      .andWhere('timer_key = :timerKey', scope)
      .andWhere("status IN ('scheduled', 'processing')")
      .execute();
  }

  async reschedule(
    request: ScheduleTimerRequest,
  ): Promise<ScheduledTimerHandle> {
    const normalized = normalizeRequest(request);
    return this.dataSource.transaction(async (manager) => {
      const now = new Date();
      await manager
        .createQueryBuilder()
        .update(LeadFlowScheduledTimerEntity)
        .set({
          status: 'superseded',
          supersededAt: now,
          lockedAt: null,
          lockedBy: null,
          retainUntil: addDays(now, 30),
          updatedAt: now,
        })
        .where('tenant_id = :tenantId', normalized)
        .andWhere('workspace_id = :workspaceId', normalized)
        .andWhere('dedupe_scope = :dedupeScope', normalized)
        .andWhere('timer_key = :timerKey', normalized)
        .andWhere("status IN ('scheduled', 'processing')")
        .execute();

      const timer = manager.getRepository(LeadFlowScheduledTimerEntity).create({
        tenantId: normalized.tenantId,
        workspaceId: normalized.workspaceId,
        timerKey: normalized.timerKey,
        dedupeScope: normalized.dedupeScope,
        fireAt: normalized.fireAt,
        purpose: normalized.purpose,
        consumerKey: normalized.consumerKey,
        payload: normalized.payload,
        status: 'scheduled',
        attempts: 0,
        maxAttempts: normalized.maxAttempts,
        availableAt: normalized.fireAt,
        lockedAt: null,
        lockedBy: null,
        firedAt: null,
        cancelledAt: null,
        supersededAt: null,
        deadLetteredAt: null,
        lastError: null,
        retainUntil: null,
      });
      return toHandle(await manager.save(timer));
    });
  }

  @Interval(1_000)
  async tick(): Promise<void> {
    if (this.running || this.stopping) return;
    this.running = true;
    try {
      await this.processPending(25);
      this.metrics.pruned += await this.pruneExpired(100);
    } catch (error) {
      this.logger.error(`LeadFlow scheduler failed: ${errorCode(error)}`);
    } finally {
      this.running = false;
    }
  }

  async processPending(limit = 25): Promise<number> {
    const ids = await this.dataSource.transaction(async (manager) => {
      const rows = await manager.query<Array<{ id: string }>>(
        `SELECT id
           FROM leadflow_scheduled_timers
          WHERE (
              (status = 'scheduled' AND fire_at <= now() AND available_at <= now())
              OR (status = 'processing' AND locked_at < now() - interval '1 minute')
            )
          ORDER BY fire_at, id
          FOR UPDATE SKIP LOCKED
          LIMIT $1`,
        [Math.max(1, limit)],
      );
      if (rows.length > 0) {
        await manager
          .createQueryBuilder()
          .update(LeadFlowScheduledTimerEntity)
          .set({
            status: 'processing',
            lockedAt: new Date(),
            lockedBy: this.workerId,
            attempts: () => 'attempts + 1',
            updatedAt: new Date(),
          })
          .whereInIds(rows.map((row) => row.id))
          .execute();
      }
      return rows.map((row) => row.id);
    });

    this.metrics.claimed += ids.length;
    for (const id of ids) await this.processOne(id);
    return ids.length;
  }

  private async processOne(id: string): Promise<void> {
    const repository = this.dataSource.getRepository(
      LeadFlowScheduledTimerEntity,
    );
    const timer = await repository.findOneBy({
      id,
      status: 'processing',
      lockedBy: this.workerId,
    });
    if (!timer) return;

    const firedAt = new Date();
    try {
      const consumer = this.consumers.resolve(timer.consumerKey);
      if (!consumer) throw new Error('scheduled_timer_consumer_unavailable');
      const envelope: TimerFireEnvelope = {
        timerId: timer.id,
        timerKey: timer.timerKey,
        tenantId: timer.tenantId,
        workspaceId: timer.workspaceId,
        purpose: timer.purpose,
        consumerKey: timer.consumerKey,
        payload: timer.payload,
        scheduledAt: timer.createdAt.toISOString(),
        firedAt: firedAt.toISOString(),
        attempt: timer.attempts,
      };
      await consumer.handleTimer(envelope);
      await repository.update(
        { id: timer.id, status: 'processing', lockedBy: this.workerId },
        {
          status: 'fired',
          firedAt,
          lockedAt: null,
          lockedBy: null,
          lastError: null,
          retainUntil: addDays(firedAt, 30),
          updatedAt: firedAt,
        },
      );
      this.metrics.fired += 1;
      this.metrics.lastLagMs = Math.max(
        0,
        firedAt.getTime() - timer.fireAt.getTime(),
      );
    } catch (error) {
      const dead = timer.attempts >= timer.maxAttempts;
      await repository.update(
        { id: timer.id, status: 'processing', lockedBy: this.workerId },
        dead
          ? {
              status: 'dead_letter',
              deadLetteredAt: firedAt,
              lockedAt: null,
              lockedBy: null,
              lastError: errorCode(error),
              retainUntil: addDays(firedAt, 90),
              updatedAt: firedAt,
            }
          : {
              status: 'scheduled',
              availableAt: new Date(
                Date.now() +
                  Math.min(
                    60_000,
                    1_000 * 2 ** Math.max(0, timer.attempts - 1),
                  ),
              ),
              lockedAt: null,
              lockedBy: null,
              lastError: errorCode(error),
              updatedAt: firedAt,
            },
      );
      this.metrics.failed += 1;
      if (dead) this.metrics.deadLettered += 1;
    }
  }

  async pruneExpired(limit = 100): Promise<number> {
    const rows = await this.dataSource.query<Array<{ id: string }>>(
      `SELECT id
         FROM leadflow_scheduled_timers
        WHERE status IN ('fired', 'cancelled', 'superseded', 'dead_letter')
          AND retain_until IS NOT NULL
          AND retain_until < now()
        ORDER BY retain_until, id
        LIMIT $1`,
      [Math.max(1, limit)],
    );
    if (rows.length === 0) return 0;
    const result = await this.dataSource
      .createQueryBuilder()
      .delete()
      .from(LeadFlowScheduledTimerEntity)
      .whereInIds(rows.map((row) => row.id))
      .execute();
    return result.affected ?? 0;
  }

  private findActive(
    manager: EntityManager,
    request: NormalizedScheduleRequest,
  ): Promise<LeadFlowScheduledTimerEntity | null> {
    return manager
      .getRepository(LeadFlowScheduledTimerEntity)
      .createQueryBuilder('timer')
      .setLock('pessimistic_write')
      .where('timer.tenant_id = :tenantId', request)
      .andWhere('timer.workspace_id = :workspaceId', request)
      .andWhere('timer.dedupe_scope = :dedupeScope', request)
      .andWhere('timer.timer_key = :timerKey', request)
      .andWhere("timer.status IN ('scheduled', 'processing')")
      .getOne();
  }
}

interface NormalizedScheduleRequest {
  tenantId: string;
  workspaceId: string;
  timerKey: string;
  dedupeScope: string;
  fireAt: Date;
  purpose: ScheduleTimerRequest['purpose'];
  consumerKey: string;
  payload: ScheduleTimerRequest['payload'];
  maxAttempts: number;
}

function normalizeRequest(
  request: ScheduleTimerRequest,
): NormalizedScheduleRequest {
  const scope = normalizeScope(request);
  const fireAt = new Date(request.fireAt);
  if (!Number.isFinite(fireAt.getTime()))
    throw new Error('scheduled_timer_fire_at_invalid');
  const consumerKey = request.consumerKey.trim();
  if (!consumerKey) throw new Error('scheduled_timer_consumer_key_required');
  return {
    ...scope,
    fireAt,
    purpose: request.purpose,
    consumerKey,
    payload: request.payload,
    maxAttempts: Math.max(
      1,
      Math.min(
        MAX_MAX_ATTEMPTS,
        Number.isInteger(request.maxAttempts)
          ? (request.maxAttempts as number)
          : DEFAULT_MAX_ATTEMPTS,
      ),
    ),
  };
}

function normalizeScope(request: CancelTimerRequest): {
  tenantId: string;
  workspaceId: string;
  timerKey: string;
  dedupeScope: string;
} {
  const tenantId = request.tenantId.trim();
  const workspaceId = request.workspaceId.trim();
  const timerKey = request.timerKey.trim();
  const dedupeScope = request.dedupeScope?.trim() ?? '';
  if (!tenantId || !workspaceId)
    throw new Error('scheduled_timer_scope_required');
  if (!timerKey) throw new Error('scheduled_timer_key_required');
  return { tenantId, workspaceId, timerKey, dedupeScope };
}

function toHandle(timer: LeadFlowScheduledTimerEntity): ScheduledTimerHandle {
  if (timer.status !== 'scheduled' && timer.status !== 'processing') {
    throw new Error('scheduled_timer_handle_state_invalid');
  }
  return {
    timerId: timer.id,
    timerKey: timer.timerKey,
    status: 'scheduled',
    fireAt: timer.fireAt.toISOString(),
  };
}

function addDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * 24 * 60 * 60 * 1_000);
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === '23505'
  );
}

function errorCode(error: unknown): string {
  const value =
    error instanceof Error ? error.message : 'timer_delivery_failed';
  return /^[a-z0-9_.:-]{1,100}$/i.test(value) ? value : 'timer_delivery_failed';
}
