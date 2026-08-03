import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, IsNull, LessThanOrEqual, Repository } from 'typeorm';
import type { RequestContext } from '../../../common/context/request-context.interface';
import { LeadFlowBriefingExtractionJobEntity } from '../entities';
import { LeadFlowBriefingJobStatus } from '../enums/leadflow-briefing-job-status.enum';
import type {
  BriefingExtractionJobResponse,
  EnqueueExtractionJobInput,
} from '../dto';
import { LeadFlowBriefingJobStateMachine } from './leadflow-briefing-job-state-machine';

const AGENCY_CONNECTION = 'agency';
const DEFAULT_JOB_KIND = 'ai_extraction';

/**
 * Enqueues and transitions extraction jobs ("job"). No worker claims these
 * yet (that's F4-003) — this service only proves the idempotency/state-machine
 * contract the worker will rely on.
 */
@Injectable()
export class LeadFlowBriefingExtractionJobService {
  constructor(
    @InjectDataSource(AGENCY_CONNECTION)
    private readonly dataSource: DataSource,
    private readonly stateMachine: LeadFlowBriefingJobStateMachine,
  ) {}

  /** Idempotent by (source_version_id, job_kind): re-enqueueing returns the existing job, never a duplicate row. */
  async enqueueJob(
    ctx: RequestContext,
    input: EnqueueExtractionJobInput,
  ): Promise<BriefingExtractionJobResponse> {
    const workspaceId = this.requireWorkspaceId(ctx);
    const jobKind = input.jobKind ?? DEFAULT_JOB_KIND;
    const idempotencyKey = `briefing-extraction:${input.sourceVersionId}:${jobKind}`;
    const repo = this.dataSource.getRepository(LeadFlowBriefingExtractionJobEntity);

    const existing = await repo.findOne({
      where: { tenantId: ctx.tenantId, workspaceId, idempotencyKey },
    });
    if (existing) return this.mapJob(existing);

    const job = await repo.save(
      repo.create({
        tenantId: ctx.tenantId,
        workspaceId,
        settingsId: input.settingsId,
        sourceId: input.sourceId,
        sourceVersionId: input.sourceVersionId,
        jobKind,
        idempotencyKey,
        createdById: input.createdById,
      }),
    );
    return this.mapJob(job);
  }

  async transitionJob(
    ctx: RequestContext,
    jobId: string,
    to: LeadFlowBriefingJobStatus,
    options: { lastError?: string } = {},
  ): Promise<BriefingExtractionJobResponse> {
    const workspaceId = this.requireWorkspaceId(ctx);

    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(LeadFlowBriefingExtractionJobEntity);
      const job = await repo.findOne({
        where: { id: jobId, tenantId: ctx.tenantId, workspaceId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!job) throw new NotFoundException('Extraction job not found.');

      this.stateMachine.assertTransition(job.status, to, job.attempts, job.maxAttempts);

      const now = new Date();
      job.status = to;

      switch (to) {
        case LeadFlowBriefingJobStatus.Processing:
          job.attempts += 1;
          job.startedAt = now;
          job.lockedAt = now;
          break;
        case LeadFlowBriefingJobStatus.Succeeded:
          job.completedAt = now;
          job.lockedAt = null;
          break;
        case LeadFlowBriefingJobStatus.Failed:
          job.failedAt = now;
          job.lockedAt = null;
          if (options.lastError) job.lastError = options.lastError;
          break;
        case LeadFlowBriefingJobStatus.Queued:
          job.availableAt = now;
          job.lockedAt = null;
          break;
        case LeadFlowBriefingJobStatus.Cancelled:
          job.cancelledAt = now;
          job.lockedAt = null;
          break;
        case LeadFlowBriefingJobStatus.DeadLetter:
          job.deadLetteredAt = now;
          job.lockedAt = null;
          break;
      }

      const saved = await repo.save(job);
      return this.mapJob(saved);
    });
  }

  /** Demonstrates the worker claim query shape (queued, due, unlocked) without leasing anything — the actual claim loop is F4-003's job. */
  async findClaimableJobs(
    repo: Repository<LeadFlowBriefingExtractionJobEntity> = this.dataSource.getRepository(
      LeadFlowBriefingExtractionJobEntity,
    ),
    now: Date = new Date(),
  ): Promise<LeadFlowBriefingExtractionJobEntity[]> {
    return repo.find({
      where: {
        status: LeadFlowBriefingJobStatus.Queued,
        availableAt: LessThanOrEqual(now),
        lockedAt: IsNull(),
      },
    });
  }

  private mapJob(
    job: LeadFlowBriefingExtractionJobEntity,
  ): BriefingExtractionJobResponse {
    return {
      id: job.id,
      sourceVersionId: job.sourceVersionId,
      status: job.status,
      attempts: job.attempts,
      idempotencyKey: job.idempotencyKey,
    };
  }

  private requireWorkspaceId(ctx: RequestContext): string {
    if (!ctx.workspaceId) {
      throw new BadRequestException('Workspace context is required.');
    }
    return ctx.workspaceId;
  }
}
