import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, QueryFailedError, Repository } from 'typeorm';
import type { ResolvedOrganicAnalyticsCredential } from '../credentials/social-organic-credential.resolver';
import { SocialOrganicCredentialResolver } from '../credentials/social-organic-credential.resolver';
import { SocialOrganicAssetEntity } from '../entities/social-organic-asset.entity';
import {
  SocialOrganicSyncRunEntity,
  type SocialOrganicSyncRunStatus,
} from './entities/social-organic-sync-run.entity';
import {
  calendarDayIn,
  enumerateCalendarDays,
} from './social-organic-analytics-time';

const UNIQUE_VIOLATION = '23505';
const SETTLED: readonly SocialOrganicSyncRunStatus[] = [
  'succeeded',
  'partial',
  'failed',
  'dead_letter',
  'cancelled',
];
export const SOCIAL_ORGANIC_SYNC_LEASE_MS = 10 * 60_000;
export const SOCIAL_ORGANIC_MAX_ON_DEMAND_DAYS = 7;

export type SocialOrganicSyncCandidate = {
  assetId: string;
  tenantId: string;
  workspaceId: string;
  agencyClientId: string | null;
  companyContextId?: string | null;
};

export type SocialOrganicSyncRunCounters = {
  rowsWritten: number;
  rowsSkipped: number;
  apiCalls: number;
};

export type SocialOrganicSyncRequestResult = {
  runId: string;
  status: SocialOrganicSyncRunStatus;
  startedAt: string | null;
  completedAt: string | null;
  safeReason: string | null;
  deduplicated: boolean;
};

function returnedRows<T>(result: unknown): T[] {
  if (!Array.isArray(result)) return [];
  const [first] = result as unknown[];
  return Array.isArray(first) ? (first as T[]) : (result as T[]);
}

@Injectable()
export class SocialOrganicSyncRunService {
  private readonly logger = new Logger(SocialOrganicSyncRunService.name);

  constructor(
    @InjectRepository(SocialOrganicSyncRunEntity, 'agency')
    private readonly runs: Repository<SocialOrganicSyncRunEntity>,
    @InjectRepository(SocialOrganicAssetEntity, 'agency')
    private readonly assets: Repository<SocialOrganicAssetEntity>,
    @InjectDataSource('agency') private readonly dataSource: DataSource,
    private readonly credentialResolver: SocialOrganicCredentialResolver,
  ) {}

  async request(
    input: SocialOrganicSyncCandidate & {
      fromDate?: string;
      toDate?: string;
    },
  ): Promise<SocialOrganicSyncRequestResult> {
    if ((input.fromDate === undefined) !== (input.toDate === undefined)) {
      throw new BadRequestException('sync_window_incomplete');
    }

    const resolved = await this.credentialResolver.resolveForAnalytics(input);
    const today = calendarDayIn(resolved.assetTimezone, new Date());
    const fromDate = input.fromDate ?? today;
    const toDate = input.toDate ?? today;
    const days = this.validateWindow(fromDate, toDate);

    if (toDate > today) throw new BadRequestException('sync_window_in_future');
    if (days.length > SOCIAL_ORGANIC_MAX_ON_DEMAND_DAYS) {
      throw new BadRequestException('sync_window_too_large');
    }

    const enqueued = await this.enqueue({
      resolved,
      runKind: 'manual',
      fromDate,
      toDate,
    });
    return this.toRequestResult(enqueued.run, enqueued.deduplicated);
  }

  async listSchedulableCandidates(
    limit: number,
  ): Promise<SocialOrganicSyncCandidate[]> {
    const assets = await this.assets.find({
      relations: { connection: true },
      where: {
        provider: 'meta',
        status: 'active',
        connection: {
          provider: 'meta',
          connectionStatus: 'connected',
          credentialRemovedAt: IsNull(),
        },
      },
      order: { createdAt: 'ASC' },
      take: Math.max(1, Math.trunc(limit)),
    });

    return assets.map((asset) => ({
      assetId: asset.id,
      tenantId: asset.tenantId,
      workspaceId: asset.workspaceId,
      agencyClientId: asset.agencyClientId,
      companyContextId: asset.companyContextId,
    }));
  }

  async enqueue(input: {
    resolved: ResolvedOrganicAnalyticsCredential;
    runKind: 'manual' | 'scheduled';
    fromDate: string;
    toDate: string;
  }): Promise<{ run: SocialOrganicSyncRunEntity; deduplicated: boolean }> {
    this.validateWindow(input.fromDate, input.toDate);
    const { credential } = input.resolved;
    const idempotencyKey = this.idempotencyKey({
      assetId: credential.assetId,
      runKind: input.runKind,
      fromDate: input.fromDate,
      toDate: input.toDate,
    });

    try {
      const run = await this.runs.save(
        this.runs.create({
          tenantId: credential.tenantId,
          workspaceId: credential.workspaceId,
          agencyClientId: credential.agencyClientId,
          assetId: credential.assetId,
          provider: credential.provider,
          runKind: input.runKind,
          status: 'queued',
          windowStart: input.fromDate,
          windowEnd: input.toDate,
          idempotencyKey,
        }),
      );
      return { run, deduplicated: false };
    } catch (error) {
      if (!this.isUniqueViolation(error)) throw error;
      const existing = await this.runs.findOne({
        where: [
          { assetId: credential.assetId, idempotencyKey, status: 'queued' },
          { assetId: credential.assetId, idempotencyKey, status: 'processing' },
        ],
      });
      if (!existing) throw error;
      return { run: existing, deduplicated: true };
    }
  }

  async hasSettledRun(
    assetId: string,
    idempotencyKey: string,
  ): Promise<boolean> {
    return (
      (await this.runs.count({
        where: SETTLED.map((status) => ({ assetId, idempotencyKey, status })),
      })) > 0
    );
  }

  idempotencyKey(input: {
    assetId: string;
    runKind: 'manual' | 'scheduled';
    fromDate: string;
    toDate: string;
  }): string {
    return [
      'organic-insights',
      input.assetId,
      input.runKind,
      input.fromDate,
      input.toDate,
    ].join(':');
  }

  async claim(input: {
    workerId: string;
    limit: number;
    now?: Date;
  }): Promise<SocialOrganicSyncRunEntity[]> {
    const now = input.now ?? new Date();
    const limit = Math.max(1, Math.trunc(input.limit));
    const ids = await this.dataSource.transaction(async (manager) => {
      const rows = await manager.query<{ id: string }[]>(
        `SELECT id
           FROM social_organic_sync_runs
          WHERE status = 'queued' AND available_at <= $1
          ORDER BY available_at, created_at
          FOR UPDATE SKIP LOCKED
          LIMIT $2`,
        [now, limit],
      );
      if (rows.length === 0) return [];
      const claimed = rows.map((row) => row.id);
      const updated: unknown = await manager.query(
        `UPDATE social_organic_sync_runs
            SET status = 'processing', locked_at = $2, locked_by = $3,
                started_at = COALESCE(started_at, $2), attempts = attempts + 1,
                updated_at = now()
          WHERE id = ANY($1::uuid[]) AND status = 'queued'
          RETURNING id`,
        [claimed, now, input.workerId],
      );
      return returnedRows<{ id: string }>(updated).map((row) => row.id);
    });

    return ids.length === 0
      ? []
      : this.runs.find({ where: ids.map((id) => ({ id })) });
  }

  async recoverStale(input: { now?: Date; leaseMs?: number } = {}): Promise<{
    requeued: number;
    deadLettered: number;
  }> {
    const now = input.now ?? new Date();
    const expiredBefore = new Date(
      now.getTime() - (input.leaseMs ?? SOCIAL_ORGANIC_SYNC_LEASE_MS),
    );
    const result: unknown = await this.dataSource.query(
      `UPDATE social_organic_sync_runs
          SET status = CASE WHEN attempts >= max_attempts THEN 'dead_letter' ELSE 'queued' END,
              available_at = CASE WHEN attempts >= max_attempts THEN available_at ELSE $2 END,
              finished_at = CASE WHEN attempts >= max_attempts THEN $2 ELSE finished_at END,
              locked_at = NULL, locked_by = NULL, last_error = 'lease_expired',
              updated_at = now()
        WHERE status = 'processing' AND locked_at IS NOT NULL AND locked_at < $1
        RETURNING status`,
      [expiredBefore, now],
    );
    const rows = returnedRows<{ status: string }>(result);
    const requeued = rows.filter((row) => row.status === 'queued').length;
    const deadLettered = rows.length - requeued;
    if (rows.length > 0) {
      this.logger.warn(
        `Recovered stale organic analytics runs: ${JSON.stringify({ requeued, deadLettered })}`,
      );
    }
    return { requeued, deadLettered };
  }

  markSucceeded(input: {
    runId: string;
    lockedBy: string;
    counters: SocialOrganicSyncRunCounters;
  }): Promise<boolean> {
    return this.finish('succeeded', { ...input, lastError: null });
  }

  markFailed(input: {
    runId: string;
    lockedBy: string;
    counters: SocialOrganicSyncRunCounters;
    lastError: string;
  }): Promise<boolean> {
    return this.finish('failed', input);
  }

  markDeadLetter(input: {
    runId: string;
    lockedBy: string;
    counters: SocialOrganicSyncRunCounters;
    lastError: string;
  }): Promise<boolean> {
    return this.finish('dead_letter', input);
  }

  async reschedule(input: {
    runId: string;
    lockedBy: string;
    counters: SocialOrganicSyncRunCounters;
    lastError: string;
    availableAt: Date;
  }): Promise<boolean> {
    const result: unknown = await this.dataSource.query(
      `UPDATE social_organic_sync_runs
          SET status = 'queued', available_at = $2,
              rows_written = rows_written + $3,
              rows_skipped = rows_skipped + $4,
              api_calls = api_calls + $5,
              failed_segments = $6::jsonb, last_error = $7,
              locked_at = NULL, locked_by = NULL, updated_at = now()
        WHERE id = $1 AND status = 'processing' AND locked_by = $8
        RETURNING id`,
      [
        input.runId,
        input.availableAt,
        input.counters.rowsWritten,
        input.counters.rowsSkipped,
        input.counters.apiCalls,
        JSON.stringify([
          { segment: 'meta_insights', errorCode: input.lastError },
        ]),
        input.lastError,
        input.lockedBy,
      ],
    );
    return returnedRows(result).length > 0;
  }

  private async finish(
    status: 'succeeded' | 'failed' | 'dead_letter',
    input: {
      runId: string;
      lockedBy: string;
      counters: SocialOrganicSyncRunCounters;
      lastError: string | null;
    },
  ): Promise<boolean> {
    const result: unknown = await this.dataSource.query(
      `UPDATE social_organic_sync_runs
          SET status = $2,
              rows_written = rows_written + $3,
              rows_skipped = rows_skipped + $4,
              api_calls = api_calls + $5,
              failed_segments = $6::jsonb, last_error = $7,
              finished_at = now(), locked_at = NULL, locked_by = NULL,
              updated_at = now()
        WHERE id = $1 AND status = 'processing' AND locked_by = $8
        RETURNING id`,
      [
        input.runId,
        status,
        input.counters.rowsWritten,
        input.counters.rowsSkipped,
        input.counters.apiCalls,
        JSON.stringify(
          input.lastError
            ? [{ segment: 'meta_insights', errorCode: input.lastError }]
            : [],
        ),
        input.lastError,
        input.lockedBy,
      ],
    );
    return returnedRows(result).length > 0;
  }

  private validateWindow(fromDate: string, toDate: string): string[] {
    try {
      return enumerateCalendarDays(fromDate, toDate);
    } catch {
      throw new BadRequestException('invalid_sync_window');
    }
  }

  private toRequestResult(
    run: SocialOrganicSyncRunEntity,
    deduplicated: boolean,
  ): SocialOrganicSyncRequestResult {
    return {
      runId: run.id,
      status: run.status,
      startedAt: run.startedAt?.toISOString() ?? null,
      completedAt: run.finishedAt?.toISOString() ?? null,
      safeReason: run.lastError,
      deduplicated,
    };
  }

  private isUniqueViolation(error: unknown): boolean {
    if (!(error instanceof QueryFailedError)) return false;
    return (
      (error.driverError as { code?: unknown } | undefined)?.code ===
      UNIQUE_VIOLATION
    );
  }
}
