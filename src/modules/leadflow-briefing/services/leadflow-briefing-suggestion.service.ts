import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { RequestContext } from '../../../common/context/request-context.interface';
import { LeadFlowClientSettingsEntity } from '../../leadflow-settings/entities';
import { CompanyContextService } from '../../leadflow-settings/services/company-context.service';
import {
  LeadFlowBriefingContextSnapshotEntity,
  LeadFlowBriefingSourceVersionEntity,
  LeadFlowBriefingSuggestionApplicationEntity,
  LeadFlowBriefingSuggestionEntity,
} from '../entities';
import { LeadFlowBriefingSnapshotKind } from '../enums/leadflow-briefing-snapshot-kind.enum';
import { LeadFlowBriefingSuggestionStatus } from '../enums/leadflow-briefing-suggestion-status.enum';
import type {
  ApplySuggestionInput,
  BriefingApplicationResponse,
  BriefingFieldProvenanceResponse,
  BriefingSuggestionResponse,
  RecordSuggestionsInput,
  RejectSuggestionInput,
} from '../dto';
import { getAtFieldPath, isValidFieldPath, setAtFieldPath } from './field-path.util';

const AGENCY_CONNECTION = 'agency';

/**
 * Records extraction suggestions and turns human decisions (apply/reject)
 * into draft mutations — the module's core "no silent overwrite" guarantee.
 */
@Injectable()
export class LeadFlowBriefingSuggestionService {
  constructor(
    @InjectDataSource(AGENCY_CONNECTION)
    private readonly dataSource: DataSource,
    private readonly companyContextService: CompanyContextService,
  ) {}

  /**
   * Inserts one suggestion per field from a job's extraction result. A field
   * with an existing *pending* sibling auto-supersedes it (nothing was ever
   * committed). A field with an existing *applied* sibling is never touched —
   * the new suggestion is marked as conflicting and a human must decide.
   */
  async recordSuggestions(
    ctx: RequestContext,
    input: RecordSuggestionsInput,
  ): Promise<BriefingSuggestionResponse[]> {
    const workspaceId = this.requireWorkspaceId(ctx);

    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(LeadFlowBriefingSuggestionEntity);
      const results: BriefingSuggestionResponse[] = [];

      for (const candidate of input.suggestions) {
        if (!isValidFieldPath(candidate.fieldPath)) {
          throw new BadRequestException(
            `Unknown or forbidden field path: ${candidate.fieldPath}.`,
          );
        }

        const duplicateInJob = await repo.findOne({
          where: { extractionJobId: input.extractionJobId, fieldPath: candidate.fieldPath },
        });
        if (duplicateInJob) {
          throw new ConflictException(
            `Job already produced a suggestion for ${candidate.fieldPath}.`,
          );
        }

        const pendingSibling = await repo.findOne({
          where: {
            tenantId: ctx.tenantId,
            workspaceId,
            settingsId: input.settingsId,
            fieldPath: candidate.fieldPath,
            status: LeadFlowBriefingSuggestionStatus.Pending,
          },
        });
        const appliedSibling = await repo.findOne({
          where: {
            tenantId: ctx.tenantId,
            workspaceId,
            settingsId: input.settingsId,
            fieldPath: candidate.fieldPath,
            status: LeadFlowBriefingSuggestionStatus.Applied,
          },
        });

        const suggestion = await repo.save(
          repo.create({
            tenantId: ctx.tenantId,
            workspaceId,
            settingsId: input.settingsId,
            extractionJobId: input.extractionJobId,
            sourceVersionId: input.sourceVersionId,
            fieldPath: candidate.fieldPath,
            suggestedValue: candidate.suggestedValue,
            confidence: candidate.confidence != null ? String(candidate.confidence) : null,
            rationale: candidate.rationale ?? null,
            conflictsWithSuggestionId: appliedSibling ? appliedSibling.id : null,
          }),
        );

        if (pendingSibling) {
          pendingSibling.status = LeadFlowBriefingSuggestionStatus.Superseded;
          pendingSibling.supersededBySuggestionId = suggestion.id;
          await repo.save(pendingSibling);
        }

        results.push(this.mapSuggestion(suggestion));
      }

      return results;
    });
  }

  /**
   * Applies exactly one pending suggestion: writes only its field into the
   * draft (siblings untouched), records an immutable application row and a
   * new context snapshot, all in one transaction. A suggestion can be
   * applied at most once — enforced here and by the DB unique constraint.
   */
  async applySuggestion(
    ctx: RequestContext,
    input: ApplySuggestionInput,
  ): Promise<BriefingApplicationResponse> {
    const workspaceId = this.requireWorkspaceId(ctx);

    return this.dataSource.transaction(async (manager) => {
      const suggestionRepo = manager.getRepository(LeadFlowBriefingSuggestionEntity);
      const settingsRepo = manager.getRepository(LeadFlowClientSettingsEntity);
      const snapshotRepo = manager.getRepository(LeadFlowBriefingContextSnapshotEntity);
      const applicationRepo = manager.getRepository(
        LeadFlowBriefingSuggestionApplicationEntity,
      );

      const suggestion = await suggestionRepo.findOne({
        where: { id: input.suggestionId, tenantId: ctx.tenantId, workspaceId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!suggestion) throw new NotFoundException('Suggestion not found.');
      if (suggestion.status !== LeadFlowBriefingSuggestionStatus.Pending) {
        throw new ConflictException(
          `Suggestion is ${suggestion.status}, only a pending suggestion can be applied.`,
        );
      }

      const settings = await settingsRepo.findOne({
        where: { id: suggestion.settingsId, tenantId: ctx.tenantId, workspaceId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!settings) throw new NotFoundException('LeadFlow settings not found.');

      const previousValue = getAtFieldPath(
        settings.companyContextDraft ?? {},
        suggestion.fieldPath,
      );
      const mutatedDraft = setAtFieldPath(
        settings.companyContextDraft ?? {},
        suggestion.fieldPath,
        suggestion.suggestedValue,
      );
      const normalizedDraft = this.companyContextService.normalizePersisted(mutatedDraft);
      const draftHash = this.companyContextService.hash(normalizedDraft);

      settings.companyContextDraft = normalizedDraft;
      settings.companyContextSchemaVersion = 1;
      settings.updatedById = input.appliedById;
      await settingsRepo.save(settings);

      const snapshot = await snapshotRepo.save(
        snapshotRepo.create({
          tenantId: ctx.tenantId,
          workspaceId,
          settingsId: settings.id,
          snapshotKind: LeadFlowBriefingSnapshotKind.SuggestionApplied,
          draftValue: normalizedDraft,
          draftHash,
          createdById: input.appliedById,
        }),
      );

      const application = await applicationRepo.save(
        applicationRepo.create({
          tenantId: ctx.tenantId,
          workspaceId,
          settingsId: settings.id,
          suggestionId: suggestion.id,
          fieldPath: suggestion.fieldPath,
          previousValue: previousValue ?? null,
          appliedValue: suggestion.suggestedValue,
          resultingSnapshotId: snapshot.id,
          appliedById: input.appliedById,
        }),
      );

      suggestion.status = LeadFlowBriefingSuggestionStatus.Applied;
      await suggestionRepo.save(suggestion);

      return {
        id: application.id,
        suggestionId: application.suggestionId,
        fieldPath: application.fieldPath,
        resultingSnapshotId: application.resultingSnapshotId,
        createdAt: application.createdAt,
      };
    });
  }

  async rejectSuggestion(
    ctx: RequestContext,
    input: RejectSuggestionInput,
  ): Promise<BriefingSuggestionResponse> {
    const workspaceId = this.requireWorkspaceId(ctx);
    const repo = this.dataSource.getRepository(LeadFlowBriefingSuggestionEntity);

    const suggestion = await repo.findOne({
      where: { id: input.suggestionId, tenantId: ctx.tenantId, workspaceId },
    });
    if (!suggestion) throw new NotFoundException('Suggestion not found.');
    if (suggestion.status !== LeadFlowBriefingSuggestionStatus.Pending) {
      throw new ConflictException(
        `Suggestion is ${suggestion.status}, only a pending suggestion can be rejected.`,
      );
    }

    suggestion.status = LeadFlowBriefingSuggestionStatus.Rejected;
    suggestion.decidedById = input.decidedById;
    suggestion.decidedAt = new Date();
    const saved = await repo.save(suggestion);
    return this.mapSuggestion(saved);
  }

  /** No application row = manual/legacy origin. Never treated as an absence of data — always an explicit answer. */
  async getFieldProvenance(
    ctx: RequestContext,
    settingsId: string,
    fieldPath: string,
  ): Promise<BriefingFieldProvenanceResponse> {
    const workspaceId = this.requireWorkspaceId(ctx);
    const applicationRepo = this.dataSource.getRepository(
      LeadFlowBriefingSuggestionApplicationEntity,
    );

    const application = await applicationRepo.findOne({
      where: { tenantId: ctx.tenantId, workspaceId, settingsId, fieldPath },
      order: { createdAt: 'DESC' },
    });
    if (!application) return { fieldPath, origin: 'manual' };

    const suggestion = await this.dataSource
      .getRepository(LeadFlowBriefingSuggestionEntity)
      .findOne({ where: { id: application.suggestionId } });
    const sourceVersion = suggestion
      ? await this.dataSource
          .getRepository(LeadFlowBriefingSourceVersionEntity)
          .findOne({ where: { id: suggestion.sourceVersionId } })
      : null;

    return {
      fieldPath,
      origin: 'suggestion',
      suggestionId: application.suggestionId,
      sourceVersionId: sourceVersion?.id,
      sourceId: sourceVersion?.sourceId,
      appliedAt: application.createdAt,
      appliedById: application.appliedById,
    };
  }

  private mapSuggestion(
    suggestion: LeadFlowBriefingSuggestionEntity,
  ): BriefingSuggestionResponse {
    return {
      id: suggestion.id,
      fieldPath: suggestion.fieldPath,
      status: suggestion.status,
      conflictsWithSuggestionId: suggestion.conflictsWithSuggestionId,
      supersededBySuggestionId: suggestion.supersededBySuggestionId,
    };
  }

  private requireWorkspaceId(ctx: RequestContext): string {
    if (!ctx.workspaceId) {
      throw new BadRequestException('Workspace context is required.');
    }
    return ctx.workspaceId;
  }
}
