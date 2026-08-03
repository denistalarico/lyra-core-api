import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { hostname } from 'node:os';
import { Readable } from 'node:stream';
import { DataSource } from 'typeorm';
import type { RequestContext } from '../../../common/context/request-context.interface';
import { FilesService } from '../../../common/files/files.service';
import { PlatformPermissionService } from '../../permissions/services/platform-permission.service';
import { getCompanyContextRootKeys } from '../../leadflow-settings/services/company-context.service';
import {
  LeadFlowBriefingExtractionJobEntity,
  LeadFlowBriefingSourceVersionEntity,
} from '../entities';
import { LeadFlowBriefingJobStatus } from '../enums/leadflow-briefing-job-status.enum';
import { LeadFlowBriefingSourceVersionStatus } from '../enums/leadflow-briefing-source-version-status.enum';
import { LeadFlowBriefingExtractionConfigService } from './leadflow-briefing-extraction-config.service';
import { LeadFlowBriefingExtractionJobService } from './leadflow-briefing-extraction-job.service';
import {
  ExtractionUsage,
  LeadFlowBriefingExtractionProvider,
} from './leadflow-briefing-extraction-provider';
import {
  LeadFlowBriefingExtractionError,
  errorCode,
} from './leadflow-briefing-extraction.errors';
import { extractPdfText } from './leadflow-briefing-pdf-text.util';
import { LeadFlowBriefingSuggestionService } from './leadflow-briefing-suggestion.service';

const AGENCY_CONNECTION = 'agency';
const STALE_LEASE_INTERVAL = '5 minutes';

/**
 * Claims queued extraction jobs and turns already-safe source-version content
 * (F4-002) into suggestion rows (via the already-built recordSuggestions).
 * Claim-loop shape mirrors AudioTranscriptionWorker / PostgresSchedulerRuntime
 * (inbox/runtime/audio-transcription.worker.ts,
 * leadflow-automations/scheduler/postgres-scheduler-runtime.service.ts):
 * SELECT ... FOR UPDATE SKIP LOCKED batch claim, then per-row processing that
 * re-fetches by {id, status:'processing', lockedBy} before doing real work so
 * a row raced away (e.g. cancelled) between claim and processing is silently
 * skipped rather than acted on.
 */
@Injectable()
export class LeadFlowBriefingExtractionWorker {
  private readonly logger = new Logger(LeadFlowBriefingExtractionWorker.name);
  private readonly workerId = `${hostname()}:${process.pid}:leadflow-extraction`;
  private running = false;

  constructor(
    @InjectDataSource(AGENCY_CONNECTION) private readonly dataSource: DataSource,
    private readonly files: FilesService,
    private readonly jobService: LeadFlowBriefingExtractionJobService,
    private readonly suggestionService: LeadFlowBriefingSuggestionService,
    private readonly provider: LeadFlowBriefingExtractionProvider,
    private readonly config: LeadFlowBriefingExtractionConfigService,
    private readonly permissionService: PlatformPermissionService,
  ) {}

  @Interval(3_000)
  async tick(): Promise<void> {
    if (this.config.mode === 'disabled' || this.running) return;
    this.running = true;
    try {
      await this.processPending(2);
    } catch (error) {
      this.logger.error(`Extraction cycle failed: ${errorCode(error)}`);
    } finally {
      this.running = false;
    }
  }

  async processPending(limit = 2): Promise<number> {
    const ids = await this.dataSource.transaction(async (manager) => {
      const rows = await manager.query<Array<{ id: string }>>(
        `SELECT id
           FROM leadflow_briefing_extraction_jobs
          WHERE (status = 'queued' AND available_at <= now())
             OR (status = 'processing' AND locked_at < now() - interval '${STALE_LEASE_INTERVAL}')
          ORDER BY available_at, id
          FOR UPDATE SKIP LOCKED
          LIMIT $1`,
        [Math.max(1, limit)],
      );
      if (rows.length > 0) {
        await manager
          .createQueryBuilder()
          .update(LeadFlowBriefingExtractionJobEntity)
          .set({
            status: LeadFlowBriefingJobStatus.Processing,
            lockedAt: new Date(),
            lockedBy: this.workerId,
            attempts: () => 'attempts + 1',
            startedAt: new Date(),
          })
          .whereInIds(rows.map((row) => row.id))
          .execute();
      }
      return rows.map((row) => row.id);
    });

    for (const id of ids) await this.processOne(id);
    return ids.length;
  }

  private async processOne(id: string): Promise<void> {
    const jobRepo = this.dataSource.getRepository(LeadFlowBriefingExtractionJobEntity);
    const job = await jobRepo.findOneBy({
      id,
      status: LeadFlowBriefingJobStatus.Processing,
      lockedBy: this.workerId,
    });
    if (!job) return;

    const ctx: RequestContext = { tenantId: job.tenantId, workspaceId: job.workspaceId };
    let reservedCents: number | undefined;

    try {
      const allowed = await this.permissionService.canAccessProduct(
        { tenantId: job.tenantId, workspaceId: job.workspaceId, userId: 'system', role: 'system' },
        'leadflow',
      );
      if (!allowed)
        throw new LeadFlowBriefingExtractionError('leadflow_entitlement_inactive');

      await this.assertWithinDailyBudget(job.tenantId, job.workspaceId);
      reservedCents = this.config.reserveCents;
      await jobRepo.update({ id: job.id }, { costBudgetCents: reservedCents });

      const version = await this.dataSource
        .getRepository(LeadFlowBriefingSourceVersionEntity)
        .findOne({
          where: {
            id: job.sourceVersionId,
            sourceId: job.sourceId,
            tenantId: job.tenantId,
            workspaceId: job.workspaceId,
          },
        });
      if (!version || version.status !== LeadFlowBriefingSourceVersionStatus.Available)
        throw new LeadFlowBriefingExtractionError('source_version_not_available');

      const { text, images } = await this.buildContent(version);
      const allowedRootKeys = getCompanyContextRootKeys();

      const result = await this.provider.extract({
        tenantId: job.tenantId,
        workspaceId: job.workspaceId,
        idempotencyKey: job.idempotencyKey,
        allowedRootKeys,
        text,
        images,
      });

      await this.suggestionService.recordSuggestions(ctx, {
        extractionJobId: job.id,
        settingsId: job.settingsId,
        sourceVersionId: job.sourceVersionId,
        suggestions: result.suggestions.map((suggestion) => ({
          fieldPath: suggestion.fieldPath,
          suggestedValue: suggestion.value,
          confidence: suggestion.confidence,
          rationale: suggestion.rationale,
        })),
      });

      const actualCents = this.estimateCostCents(result.usage);
      await this.jobService.transitionJob(ctx, job.id, LeadFlowBriefingJobStatus.Succeeded, {
        costBudgetCents: actualCents,
      });
    } catch (error) {
      const code = errorCode(error);
      this.logger.error(
        `Extraction job ${job.id} (tenant ${job.tenantId}) failed: ${code}`,
      );
      await this.jobService.transitionJob(ctx, job.id, LeadFlowBriefingJobStatus.Failed, {
        lastError: code,
        ...(reservedCents !== undefined ? { costBudgetCents: reservedCents } : {}),
      });

      const dead = job.attempts >= job.maxAttempts;
      await this.jobService.transitionJob(
        ctx,
        job.id,
        dead ? LeadFlowBriefingJobStatus.DeadLetter : LeadFlowBriefingJobStatus.Queued,
        dead ? {} : { availableAt: this.backoff(job.attempts) },
      );
    }
  }

  private async buildContent(
    version: LeadFlowBriefingSourceVersionEntity,
  ): Promise<{ text: string; images: Array<{ mimeType: string; bytes: Buffer }> }> {
    const mimeType = version.mimeType ?? '';

    if (mimeType === 'application/pdf' && version.objectKey) {
      const buffer = await this.readObject(version.objectKey, version.byteSize);
      const text = await extractPdfText(buffer, {
        maxPages: this.config.maxPdfPages,
        maxChars: this.config.maxExtractedChars,
      });
      return { text, images: [] };
    }

    if (mimeType.startsWith('image/') && version.objectKey) {
      const buffer = await this.readObject(version.objectKey, version.byteSize);
      return { text: '', images: [{ mimeType, bytes: buffer }] };
    }

    if (version.rawText != null) {
      return { text: version.rawText.slice(0, this.config.maxExtractedChars), images: [] };
    }

    if (version.objectKey) {
      const buffer = await this.readObject(version.objectKey, version.byteSize);
      return {
        text: buffer.toString('utf8').slice(0, this.config.maxExtractedChars),
        images: [],
      };
    }

    throw new LeadFlowBriefingExtractionError('unsupported_source_content');
  }

  private async readObject(objectKey: string, byteSize: string | null): Promise<Buffer> {
    const maxBytes = byteSize ? Number(byteSize) : Number.MAX_SAFE_INTEGER;
    const file = await this.files.getPrivateAsset(objectKey);
    return streamBuffer(file.body, maxBytes);
  }

  private async assertWithinDailyBudget(tenantId: string, workspaceId: string): Promise<void> {
    const rows: Array<{ spent: string }> = await this.dataSource.query(
      `SELECT COALESCE(SUM(cost_budget_cents), 0)::text AS spent
         FROM leadflow_briefing_extraction_jobs
        WHERE tenant_id = $1 AND workspace_id = $2
          AND created_at >= date_trunc('day', now())`,
      [tenantId, workspaceId],
    );
    const spent = Number(rows[0]?.spent ?? 0);
    if (spent + this.config.reserveCents > this.config.dailyBudgetCents)
      throw new LeadFlowBriefingExtractionError('extraction_budget_exhausted');
  }

  private estimateCostCents(usage: ExtractionUsage): number {
    // No confirmed per-token pricing exists for this provider/model yet —
    // the flat reserve is the honest, non-fabricated estimate until a real
    // rate is configured. usage is still recorded on the job's metadata by
    // the provider call itself for later reconciliation.
    void usage;
    return this.config.reserveCents;
  }

  private backoff(attempts: number): Date {
    const ms = Math.min(60_000, 1_000 * 2 ** Math.max(0, attempts - 1));
    return new Date(Date.now() + ms);
  }
}

async function streamBuffer(stream: Readable, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    total += part.length;
    if (total > maxBytes)
      throw new LeadFlowBriefingExtractionError('source_content_size_mismatch');
    chunks.push(part);
  }
  return Buffer.concat(chunks);
}
