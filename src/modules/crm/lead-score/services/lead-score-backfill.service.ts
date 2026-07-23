import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, MoreThan, Repository } from 'typeorm';
import type { RequestContext } from '../../../../common/context/request-context.interface';
import { CrmOpportunityEntity } from '../../entities/crm-opportunity.entity';
import { LeadScoreEngineService } from './lead-score-engine.service';

/** Kept small so one page never holds a long transaction open. */
const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 500;

export interface LeadScoreBackfillPage {
  /** Opportunities examined in this page. */
  scanned: number;
  scored: number;
  failed: number;
  /**
   * Id to resume from. Null when the scope is exhausted — the caller stops
   * when it sees this rather than guessing from a short page.
   */
  nextCursor: string | null;
  errors: Array<{ opportunityId: string; message: string }>;
}

/**
 * Scores opportunities that existed before the engine did.
 *
 * Explicitly invoked, never scheduled: this walks every deal in a workspace and
 * writes history for each, which is not something that should start by itself
 * on a deploy.
 *
 * Resumable by opportunity id rather than by offset. An offset would skip or
 * repeat rows as deals are created during the run; a keyset cursor over a
 * stable ordering does not.
 */
@Injectable()
export class LeadScoreBackfillService {
  private readonly logger = new Logger(LeadScoreBackfillService.name);

  constructor(
    @InjectRepository(CrmOpportunityEntity, 'agency')
    private readonly opportunities: Repository<CrmOpportunityEntity>,
    private readonly engine: LeadScoreEngineService,
  ) {}

  /**
   * Processes one page. The caller drives the loop, so a run can be paused,
   * resumed or abandoned without leaving a worker behind.
   *
   * Idempotent per opportunity: the engine keys each calculation, so re-running
   * a page that already succeeded produces no duplicate snapshots.
   */
  async runPage(
    ctx: RequestContext,
    options: { cursor?: string | null; pageSize?: number } = {},
  ): Promise<LeadScoreBackfillPage> {
    const pageSize = Math.min(
      Math.max(1, options.pageSize ?? DEFAULT_PAGE_SIZE),
      MAX_PAGE_SIZE,
    );
    const cursor = options.cursor ?? null;

    if (!ctx.workspaceId) {
      throw new BadRequestException('Workspace context is required.');
    }
    const page = await this.opportunities.find({
      where: {
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        deletedAt: IsNull(),
        ...(cursor ? { id: MoreThan(cursor) } : {}),
      },
      order: { id: 'ASC' },
      take: pageSize,
      select: { id: true },
    });

    const result: LeadScoreBackfillPage = {
      scanned: page.length,
      scored: 0,
      failed: 0,
      nextCursor: page.length === pageSize ? (page.at(-1)?.id ?? null) : null,
      errors: [],
    };

    // Sequential on purpose: each recalculation takes an advisory lock and
    // writes, and a burst of parallel workers would contend with ordinary CRM
    // traffic for no useful gain.
    for (const opportunity of page) {
      try {
        await this.engine.recalculate(ctx, {
          opportunityId: opportunity.id,
          reason: 'backfill',
        });
        result.scored += 1;
      } catch (error) {
        result.failed += 1;
        const message =
          error instanceof Error ? error.message : 'unknown error';
        result.errors.push({ opportunityId: opportunity.id, message });
        this.logger.warn(
          `Lead score backfill failed for ${opportunity.id}: ${message}`,
        );
      }
    }

    return result;
  }
}
