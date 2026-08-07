import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In } from 'typeorm';
import type { RequestContext } from '../../../common/context/request-context.interface';
import {
  LeadFlowBriefingSourceEntity,
  LeadFlowBriefingSourceVersionEntity,
  LeadFlowBriefingSuggestionEntity,
} from '../entities';
import { LeadFlowBriefingSourceVersionStatus } from '../enums/leadflow-briefing-source-version-status.enum';
import { LeadFlowBriefingSuggestionStatus } from '../enums/leadflow-briefing-suggestion-status.enum';
import type {
  BriefingSourceListItemResponse,
  BriefingSourceResponse,
  BriefingSourceVersionResponse,
  CreateBriefingSourceInput,
  CreateBriefingSourceVersionInput,
} from '../dto';

const AGENCY_CONNECTION = 'agency';

/** Creates briefing sources ("fonte") and their immutable versions ("duas versões" axis). No ingestion here — that's F4-002. */
@Injectable()
export class LeadFlowBriefingSourceService {
  constructor(
    @InjectDataSource(AGENCY_CONNECTION)
    private readonly dataSource: DataSource,
  ) {}

  async createSource(
    ctx: RequestContext,
    input: CreateBriefingSourceInput,
  ): Promise<BriefingSourceResponse> {
    const workspaceId = this.requireWorkspaceId(ctx);
    const repo = this.dataSource.getRepository(LeadFlowBriefingSourceEntity);
    const source = await repo.save(
      repo.create({
        tenantId: ctx.tenantId,
        workspaceId,
        contextType: input.contextType,
        agencyClientId: input.agencyClientId,
        settingsId: input.settingsId,
        kind: input.kind,
        label: input.label,
        createdById: input.createdById,
      }),
    );
    return this.mapSource(source);
  }

  /**
   * Creates a new version for a source. A byte-identical re-upload (same
   * checksum) is a no-op and returns the existing version instead of
   * spawning a spurious duplicate — the "re-upload" only becomes a new
   * version when the content actually changed.
   */
  async createSourceVersion(
    ctx: RequestContext,
    input: CreateBriefingSourceVersionInput,
  ): Promise<BriefingSourceVersionResponse> {
    const workspaceId = this.requireWorkspaceId(ctx);

    return this.dataSource.transaction(async (manager) => {
      const sourceRepo = manager.getRepository(LeadFlowBriefingSourceEntity);
      const versionRepo = manager.getRepository(LeadFlowBriefingSourceVersionEntity);

      const source = await sourceRepo.findOne({
        where: { id: input.sourceId, tenantId: ctx.tenantId, workspaceId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!source) throw new NotFoundException('Briefing source not found.');

      if (input.checksum) {
        const existing = await versionRepo.findOne({
          where: { sourceId: source.id, checksum: input.checksum },
        });
        if (existing) return this.mapVersion(existing);
      }

      const versionNumber = source.latestVersionNumber + 1;
      const version = await versionRepo.save(
        versionRepo.create({
          sourceId: source.id,
          tenantId: ctx.tenantId,
          workspaceId,
          versionNumber,
          kind: input.kind,
          objectKey: input.objectKey ?? null,
          sourceUrl: input.sourceUrl ?? null,
          rawText: input.rawText ?? null,
          mimeType: input.mimeType ?? null,
          byteSize: input.byteSize ?? null,
          checksum: input.checksum ?? null,
          safeFilename: input.safeFilename ?? null,
          createdById: input.createdById,
          ...(input.status ? { status: input.status } : {}),
          ...(input.errorCode !== undefined ? { errorCode: input.errorCode } : {}),
        }),
      );

      source.latestVersionNumber = versionNumber;
      await sourceRepo.save(source);

      return this.mapVersion(version);
    });
  }

  /**
   * Removes a source from the panel. Rows are archived rather than deleted:
   * jobs, versions and applications reference a source with ON DELETE RESTRICT
   * precisely so an already-applied field can always be traced back to what it
   * came from. Suggestions still awaiting review are rejected in the same
   * transaction — leaving them pending would keep offering fields from a
   * source the user just removed.
   */
  async archiveSource(ctx: RequestContext, sourceId: string): Promise<void> {
    const workspaceId = this.requireWorkspaceId(ctx);

    await this.dataSource.transaction(async (manager) => {
      const sourceRepo = manager.getRepository(LeadFlowBriefingSourceEntity);
      const source = await sourceRepo.findOne({
        where: { id: sourceId, tenantId: ctx.tenantId, workspaceId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!source) throw new NotFoundException('Briefing source not found.');
      if (source.status === 'archived') return;

      const versions = await manager
        .getRepository(LeadFlowBriefingSourceVersionEntity)
        .find({ where: { sourceId: source.id } });

      if (versions.length > 0) {
        await manager
          .createQueryBuilder()
          .update(LeadFlowBriefingSuggestionEntity)
          .set({
            status: LeadFlowBriefingSuggestionStatus.Rejected,
            decidedById: ctx.userId ?? null,
            decidedAt: new Date(),
          })
          .where('source_version_id IN (:...versionIds)', {
            versionIds: versions.map((version) => version.id),
          })
          .andWhere('status = :pending', {
            pending: LeadFlowBriefingSuggestionStatus.Pending,
          })
          .execute();
      }

      source.status = 'archived';
      await sourceRepo.save(source);
    });
  }

  /** Scoped lookup used by the extract-trigger route to resolve a source's settingsId. */
  async getSource(ctx: RequestContext, sourceId: string): Promise<BriefingSourceResponse> {
    const workspaceId = this.requireWorkspaceId(ctx);
    const repo = this.dataSource.getRepository(LeadFlowBriefingSourceEntity);
    const source = await repo.findOne({
      where: { id: sourceId, tenantId: ctx.tenantId, workspaceId },
    });
    if (!source) throw new NotFoundException('Briefing source not found.');
    return this.mapSource(source);
  }

  /** Lists a settings target's sources with their latest version only (no full version history — not needed by the review panel). */
  async listSources(
    ctx: RequestContext,
    settingsId: string,
  ): Promise<BriefingSourceListItemResponse[]> {
    const workspaceId = this.requireWorkspaceId(ctx);
    const sourceRepo = this.dataSource.getRepository(LeadFlowBriefingSourceEntity);
    const versionRepo = this.dataSource.getRepository(LeadFlowBriefingSourceVersionEntity);

    const sources = await sourceRepo.find({
      where: { tenantId: ctx.tenantId, workspaceId, settingsId, status: 'active' },
      order: { createdAt: 'DESC' },
    });
    if (sources.length === 0) return [];

    const versions = await versionRepo.find({
      where: { sourceId: In(sources.map((source) => source.id)) },
    });
    const latestBySource = new Map<string, LeadFlowBriefingSourceVersionEntity>();
    for (const version of versions) {
      const current = latestBySource.get(version.sourceId);
      if (!current || version.versionNumber > current.versionNumber) {
        latestBySource.set(version.sourceId, version);
      }
    }

    return sources.map((source) => {
      const latest = latestBySource.get(source.id) ?? null;
      return {
        id: source.id,
        kind: source.kind,
        label: source.label,
        status: source.status,
        latestVersion: latest
          ? {
              id: latest.id,
              versionNumber: latest.versionNumber,
              status: latest.status,
              errorCode: latest.errorCode,
              createdAt: latest.createdAt,
            }
          : null,
        createdAt: source.createdAt,
      };
    });
  }

  /**
   * Resolves an available version for extraction (same scoped-lookup shape
   * as LeadFlowBriefingContentService.getAuthorizedVersionContent) and
   * returns the owning source's settingsId, needed to enqueue a job.
   */
  async getAvailableVersionForExtraction(
    ctx: RequestContext,
    sourceId: string,
    versionId: string,
  ): Promise<{ settingsId: string; sourceId: string; versionId: string }> {
    const workspaceId = this.requireWorkspaceId(ctx);
    const sourceRepo = this.dataSource.getRepository(LeadFlowBriefingSourceEntity);
    const versionRepo = this.dataSource.getRepository(LeadFlowBriefingSourceVersionEntity);

    const source = await sourceRepo.findOne({
      where: { id: sourceId, tenantId: ctx.tenantId, workspaceId },
    });
    if (!source) throw new NotFoundException('Briefing source not found.');

    const version = await versionRepo.findOne({
      where: { id: versionId, sourceId, tenantId: ctx.tenantId, workspaceId },
    });
    if (!version) throw new NotFoundException('Briefing source version not found.');
    if (version.status !== LeadFlowBriefingSourceVersionStatus.Available) {
      throw new ConflictException(
        `Version is ${version.status}, only an available version can be extracted.`,
      );
    }

    return { settingsId: source.settingsId, sourceId: source.id, versionId: version.id };
  }

  private mapSource(source: LeadFlowBriefingSourceEntity): BriefingSourceResponse {
    return {
      id: source.id,
      settingsId: source.settingsId,
      kind: source.kind,
      label: source.label,
      status: source.status,
      latestVersionNumber: source.latestVersionNumber,
      createdAt: source.createdAt,
    };
  }

  private mapVersion(
    version: LeadFlowBriefingSourceVersionEntity,
  ): BriefingSourceVersionResponse {
    return {
      id: version.id,
      sourceId: version.sourceId,
      versionNumber: version.versionNumber,
      status: version.status,
      createdAt: version.createdAt,
    };
  }

  private requireWorkspaceId(ctx: RequestContext): string {
    if (!ctx.workspaceId) {
      throw new BadRequestException('Workspace context is required.');
    }
    return ctx.workspaceId;
  }
}
