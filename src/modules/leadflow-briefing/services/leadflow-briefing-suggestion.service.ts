import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In } from 'typeorm';
import type { RequestContext } from '../../../common/context/request-context.interface';
import { LeadFlowClientSettingsEntity } from '../../leadflow-settings/entities';
import {
  CompanyContextService,
  getCompanyContextScalarFieldPaths,
} from '../../leadflow-settings/services/company-context.service';
import {
  LeadFlowBriefingContextSnapshotEntity,
  LeadFlowBriefingSourceEntity,
  LeadFlowBriefingSourceVersionEntity,
  LeadFlowBriefingSuggestionApplicationEntity,
  LeadFlowBriefingSuggestionEntity,
} from '../entities';
import { LeadFlowBriefingSnapshotKind } from '../enums/leadflow-briefing-snapshot-kind.enum';
import { LeadFlowBriefingSourceKind } from '../enums/leadflow-briefing-source-kind.enum';
import { LeadFlowBriefingSuggestionStatus } from '../enums/leadflow-briefing-suggestion-status.enum';
import type {
  ApplySuggestionInput,
  BriefingApplicationResponse,
  BriefingFieldProvenanceResponse,
  BriefingReviewResponse,
  BriefingSuggestionListItemResponse,
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
      suggestion.decidedById = input.appliedById;
      suggestion.decidedAt = new Date();
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

  /**
   * The review panel's single read: pending/applied/rejected suggestions
   * (superseded ones are dead, never actionable, excluded) joined to their
   * source for display, plus the current draft value per row (so a conflict
   * can be shown side-by-side), plus gaps — scalar fields with no draft
   * value and no pending suggestion already covering them.
   */
  async listForReview(ctx: RequestContext, settingsId: string): Promise<BriefingReviewResponse> {
    const workspaceId = this.requireWorkspaceId(ctx);

    const settings = await this.dataSource.getRepository(LeadFlowClientSettingsEntity).findOne({
      where: { id: settingsId, tenantId: ctx.tenantId, workspaceId },
    });
    if (!settings) throw new NotFoundException('LeadFlow settings not found.');
    const draft = settings.companyContextDraft ?? {};

    const rows = await this.dataSource.getRepository(LeadFlowBriefingSuggestionEntity).find({
      where: {
        tenantId: ctx.tenantId,
        workspaceId,
        settingsId,
        status: In([
          LeadFlowBriefingSuggestionStatus.Pending,
          LeadFlowBriefingSuggestionStatus.Applied,
          LeadFlowBriefingSuggestionStatus.Rejected,
        ]),
      },
      order: { createdAt: 'DESC' },
    });

    const versionIds = [...new Set(rows.map((row) => row.sourceVersionId))];
    const versions = versionIds.length
      ? await this.dataSource
          .getRepository(LeadFlowBriefingSourceVersionEntity)
          .find({ where: { id: In(versionIds) } })
      : [];
    const versionById = new Map(versions.map((version) => [version.id, version]));

    const sourceIds = [...new Set(versions.map((version) => version.sourceId))];
    const sources = sourceIds.length
      ? await this.dataSource
          .getRepository(LeadFlowBriefingSourceEntity)
          .find({ where: { id: In(sourceIds) } })
      : [];
    const sourceById = new Map(sources.map((source) => [source.id, source]));

    const suggestions: BriefingSuggestionListItemResponse[] = rows.map((row) => {
      const version = versionById.get(row.sourceVersionId);
      const source = version ? sourceById.get(version.sourceId) : undefined;
      return {
        id: row.id,
        fieldPath: row.fieldPath,
        status: row.status,
        suggestedValue: row.suggestedValue,
        confidence: row.confidence != null ? Number(row.confidence) : null,
        rationale: row.rationale,
        currentValue: getAtFieldPath(draft, row.fieldPath) ?? null,
        conflictsWithSuggestionId: row.conflictsWithSuggestionId,
        origin: {
          sourceId: source?.id ?? '',
          sourceLabel: source?.label ?? '',
          sourceKind: source?.kind ?? version?.kind ?? LeadFlowBriefingSourceKind.Upload,
          sourceVersionId: row.sourceVersionId,
          versionNumber: version?.versionNumber ?? 0,
        },
        decidedById: row.decidedById,
        decidedAt: row.decidedAt,
        createdAt: row.createdAt,
      };
    });

    const pendingFieldPaths = new Set(
      rows
        .filter((row) => row.status === LeadFlowBriefingSuggestionStatus.Pending)
        .map((row) => row.fieldPath),
    );
    const gaps = getCompanyContextScalarFieldPaths().filter((fieldPath) => {
      if (pendingFieldPaths.has(fieldPath)) return false;
      const value = getAtFieldPath(draft, fieldPath);
      return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
    });

    return { suggestions, gaps };
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
