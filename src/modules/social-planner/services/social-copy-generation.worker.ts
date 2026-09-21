import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { hostname } from 'node:os';
import { DataSource, IsNull } from 'typeorm';
import {
  SocialCopyGenerationRunEntity,
  SocialPlanEntity,
  type SocialCopyGenerationRunStatus,
} from '../entities';
import { SocialCopyGenerationConfigService } from './social-copy-generation-config.service';
import {
  SocialCopyGenerationProvider,
  type CopyGenerationUsage,
} from './social-copy-generation-provider';
import { SocialCopyGenerationService } from './social-copy-generation.service';
import {
  copyGenerationErrorCode,
  SocialCopyGenerationError,
} from './social-copy-generation.errors';

/**
 * How long a claimed run may sit before another worker may take it. A lease
 * longer than the provider timeout plus its retries, so a slow call is not
 * stolen mid-flight.
 */
const STALE_LEASE_INTERVAL = '10 minutes';

/**
 * Claims queued copy generation runs and turns them into staged proposals (E8).
 *
 * Claim-loop shape mirrors `LeadFlowBriefingExtractionWorker` and
 * `PostgresSchedulerRuntime`: a `SELECT ... FOR UPDATE SKIP LOCKED` batch claim,
 * then per-row processing that re-fetches by `{id, status: 'processing',
 * lockedBy}` before doing real work. That re-fetch is what makes cancellation
 * meaningful — a run cancelled between claim and execution is skipped instead of
 * charged.
 *
 * AND THE RESULT IS CHECKED AGAINST THE RUN AGAIN BEFORE IT IS STAGED
 * ------------------------------------------------------------------
 * A provider call can take a minute. If the operator cancelled during it, the
 * text must not appear as a pending proposal afterwards — that would be the
 * system changing content after being told to stop. So the row is re-read inside
 * the same transaction that writes the proposals, and a terminal status discards
 * the output.
 */
@Injectable()
export class SocialCopyGenerationWorker {
  private readonly logger = new Logger(SocialCopyGenerationWorker.name);
  private readonly workerId = `${hostname()}:${process.pid}:social-copy-generation`;
  private running = false;

  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
    private readonly generationService: SocialCopyGenerationService,
    private readonly provider: SocialCopyGenerationProvider,
    private readonly config: SocialCopyGenerationConfigService,
  ) {}

  @Interval(5_000)
  async tick(): Promise<void> {
    if (this.config.mode === 'disabled' || this.running) return;
    this.running = true;
    try {
      await this.processPending(2);
    } catch (error) {
      this.logger.error(
        `Copy generation cycle failed: ${copyGenerationErrorCode(error)}`,
      );
    } finally {
      this.running = false;
    }
  }

  async processPending(limit = 2): Promise<number> {
    const ids = await this.claim(limit);
    for (const id of ids) await this.processOne(id);
    return ids.length;
  }

  private async claim(limit: number): Promise<string[]> {
    return this.dataSource.transaction(async (manager) => {
      const rows = await manager.query<Array<{ id: string }>>(
        `SELECT id
           FROM social_copy_generation_runs
          WHERE (status = 'queued' AND available_at <= now())
             OR (status = 'processing' AND locked_at < now() - interval '${STALE_LEASE_INTERVAL}')
          ORDER BY available_at, id
          FOR UPDATE SKIP LOCKED
          LIMIT $1`,
        [Math.max(1, limit)],
      );

      if (rows.length > 0) {
        const now = new Date();
        await manager
          .createQueryBuilder()
          .update(SocialCopyGenerationRunEntity)
          .set({
            status: 'processing',
            lockedAt: now,
            lockedBy: this.workerId,
            startedAt: now,
            attempts: () => 'attempts + 1',
          })
          .whereInIds(rows.map((row) => row.id))
          .execute();
      }

      return rows.map((row) => row.id);
    });
  }

  private async processOne(id: string): Promise<void> {
    const runs = this.dataSource.getRepository(SocialCopyGenerationRunEntity);

    const run = await runs.findOneBy({
      id,
      status: 'processing' as SocialCopyGenerationRunStatus,
      lockedBy: this.workerId,
    });
    if (!run) return;

    const plan = await this.dataSource.getRepository(SocialPlanEntity).findOne({
      where: {
        id: run.planId,
        tenantId: run.tenantId,
        workspaceId: run.workspaceId,
        agencyClientId:
          run.agencyClientId === null ? IsNull() : run.agencyClientId,
      },
      select: { id: true, companyContextId: true },
    });
    if (!plan) {
      await this.fail(run, 'plan_not_available', undefined);
      return;
    }

    const scope = {
      tenantId: run.tenantId,
      workspaceId: run.workspaceId,
      agencyClientId: run.agencyClientId,
      companyContextId: plan.companyContextId,
    };

    let reservedCents: number | undefined;

    try {
      /**
       * The budget is checked here and not only at enqueue. A plan-wide request
       * queues many runs at once; by the time the tenth is claimed, the first
       * nine have recorded real cost, and the reservation made at enqueue was an
       * estimate of a number that has since moved.
       */
      const remaining =
        await this.generationService.dailyBudgetRemaining(scope);
      if (remaining < this.config.reserveCents)
        throw new SocialCopyGenerationError('generation_budget_exhausted');

      reservedCents = this.config.reserveCents;
      await runs.update({ id: run.id }, { costCents: reservedCents });

      const work = await this.generationService.resolveWork(run);

      if (work.fields.length === 0)
        throw new SocialCopyGenerationError('generation_fields_empty');

      const result = await this.provider.generate({
        idempotencyKey: run.idempotencyKey,
        context: work.context,
        fields: work.fields,
        instruction: work.instruction,
        format: work.format,
        longFormCaption: work.longFormCaption,
      });

      if (result.proposals.length === 0)
        throw new SocialCopyGenerationError('generation_empty_result');

      const baseByField = new Map(
        work.fields.map((field) => [field.field, field.currentValue]),
      );

      await this.dataSource.transaction(async (manager) => {
        const repository = manager.getRepository(SocialCopyGenerationRunEntity);

        /**
         * Re-read under a write lock: the operator may have cancelled while the
         * provider was working, and staging proposals for a cancelled run would
         * put generated text in front of someone who asked for none.
         */
        const current = await repository.findOne({
          where: { id: run.id },
          lock: { mode: 'pessimistic_write' },
        });

        if (!current || current.status !== 'processing') return;

        await this.generationService.recordProposals(
          manager,
          current,
          result.proposals.map((proposal) => ({
            field: proposal.field,
            value: proposal.value,
            baseValue: baseByField.get(proposal.field) ?? null,
            rationale: proposal.rationale,
          })),
        );

        current.status = 'succeeded';
        current.completedAt = new Date();
        current.lockedAt = null;
        current.lockedBy = null;
        current.provider = result.provider;
        current.model = result.model;
        current.promptVersion = result.promptVersion;
        current.contextVersion = work.contextVersion;
        current.inputTokens = result.usage.inputTokens ?? null;
        current.cachedInputTokens = result.usage.cachedInputTokens ?? null;
        current.outputTokens = result.usage.outputTokens ?? null;
        current.costCents = this.estimateCostCents(result.usage);
        current.costIsEstimated = true;
        current.latencyMs = result.latencyMs;

        await repository.save(current);
      });
    } catch (error) {
      const code = copyGenerationErrorCode(error);
      this.logger.error(
        `Copy generation run ${run.id} (tenant ${run.tenantId}) failed: ${code}`,
      );
      await this.fail(run, code, reservedCents);
    }
  }

  /**
   * Records the failure, then either returns the run to the queue with backoff
   * or dead-letters it when attempts are spent.
   *
   * Both writes are conditional on the row still being `processing` and still
   * held by this worker. A run cancelled during the provider call must stay
   * cancelled — reviving it into `queued` would charge the operator again for
   * work they stopped.
   */
  private async fail(
    run: SocialCopyGenerationRunEntity,
    code: string,
    reservedCents: number | undefined,
  ): Promise<void> {
    const runs = this.dataSource.getRepository(SocialCopyGenerationRunEntity);
    const dead = run.attempts >= run.maxAttempts;

    const failed = await runs.update(
      {
        id: run.id,
        status: 'processing' as SocialCopyGenerationRunStatus,
        lockedBy: this.workerId,
      },
      {
        status: 'failed',
        failedAt: new Date(),
        lastError: code,
        lockedAt: null,
        lockedBy: null,
        ...(reservedCents !== undefined ? { costCents: reservedCents } : {}),
      },
    );

    if (!failed.affected) return;

    if (dead) {
      await runs.update(
        { id: run.id, status: 'failed' as SocialCopyGenerationRunStatus },
        { status: 'dead_letter', deadLetteredAt: new Date() },
      );
      return;
    }

    await runs.update(
      { id: run.id, status: 'failed' as SocialCopyGenerationRunStatus },
      { status: 'queued', availableAt: this.backoff(run.attempts) },
    );
  }

  private backoff(attempts: number): Date {
    const seconds = Math.min(300, 15 * 2 ** Math.max(0, attempts - 1));
    return new Date(Date.now() + seconds * 1_000);
  }

  /**
   * Turns token usage into cents using the configured rates.
   *
   * Rounded up, and never below the reserve: a run that reached the provider
   * cost something, and a zero would make the daily budget unable to see it.
   * Cached input tokens are billed at the input rate here because the discount
   * varies by provider and overstating our own cost is the safe direction for a
   * spend guard.
   */
  private estimateCostCents(usage: CopyGenerationUsage): number {
    const inputTokens = usage.inputTokens ?? 0;
    const outputTokens = usage.outputTokens ?? 0;

    const cents =
      (inputTokens * this.config.inputCentsPerMillionTokens) / 1_000_000 +
      (outputTokens * this.config.outputCentsPerMillionTokens) / 1_000_000;

    return Math.max(this.config.reserveCents, Math.ceil(cents));
  }
}
