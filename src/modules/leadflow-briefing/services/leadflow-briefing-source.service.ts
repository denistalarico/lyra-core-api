import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { RequestContext } from '../../../common/context/request-context.interface';
import {
  LeadFlowBriefingSourceEntity,
  LeadFlowBriefingSourceVersionEntity,
} from '../entities';
import type {
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
