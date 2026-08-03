import { randomUUID, createHash } from 'node:crypto';
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { RequestContext } from '../../../common/context/request-context.interface';
import { FilesService } from '../../../common/files/files.service';
import type { BriefingSourceVersionResponse } from '../dto';
import { LeadFlowBriefingSourceEntity } from '../entities';
import { LeadFlowBriefingSourceKind } from '../enums/leadflow-briefing-source-kind.enum';
import { LeadFlowBriefingSourceVersionStatus } from '../enums/leadflow-briefing-source-version-status.enum';
import { BRIEFING_FILE_KIND_MIME, assertExpectedKind, detectFileKind } from './magic-bytes.util';
import { MALWARE_SCANNER_ADAPTER, type MalwareScannerAdapter } from './malware-scanner.adapter';
import { LeadFlowBriefingQuotaService } from './leadflow-briefing-quota.service';
import { LeadFlowBriefingSourceService } from './leadflow-briefing-source.service';
import { SsrfSafeUrlFetcherService } from './ssrf-safe-url-fetcher.service';

const AGENCY_CONNECTION = 'agency';
const UPLOAD_ALLOWED_KINDS = new Set(['pdf', 'jpeg', 'png', 'webp'] as const);
const TEXTUAL_CONTENT_TYPE_PREFIX = 'text/';

/**
 * Orchestrates safe ingestion of Briefing source content: validate → scan →
 * (upload) → record version, in that order, so an unsafe source is rejected
 * before any DB row or stored object exists — the task's own acceptance
 * criterion, not an incidental ordering choice.
 *
 * Callers only ever supply a sourceId — settingsId is derived from the
 * tenant/workspace-scoped source lookup, never trusted as a caller-supplied
 * value that could be mismatched against the source it's paired with.
 */
@Injectable()
export class LeadFlowBriefingIngestionService {
  constructor(
    private readonly configService: ConfigService,
    private readonly filesService: FilesService,
    private readonly sourceService: LeadFlowBriefingSourceService,
    private readonly quotaService: LeadFlowBriefingQuotaService,
    private readonly ssrfSafeUrlFetcher: SsrfSafeUrlFetcherService,
    @Inject(MALWARE_SCANNER_ADAPTER)
    private readonly scanner: MalwareScannerAdapter,
    @InjectRepository(LeadFlowBriefingSourceEntity, AGENCY_CONNECTION)
    private readonly sourceRepository: Repository<LeadFlowBriefingSourceEntity>,
  ) {}

  async ingestUpload(
    ctx: RequestContext,
    sourceId: string,
    file: { buffer: Buffer; mimetype: string; originalname: string; size: number },
  ): Promise<BriefingSourceVersionResponse> {
    const source = await this.resolveSource(ctx, sourceId);

    const maxBytes = this.configService.get<number>('leadflowBriefing.maxUploadBytes') ?? 20 * 1024 * 1024;
    if (file.size > maxBytes || file.buffer.length > maxBytes) {
      throw new BadRequestException('Uploaded file exceeds the allowed size.');
    }

    const kind = assertExpectedKind(file.buffer, UPLOAD_ALLOWED_KINDS);
    await this.quotaService.assertWithinQuota(ctx, source.settingsId, file.buffer.length);
    await this.scanAndRejectIfUnsafe(file.buffer);

    const checksum = this.checksum(file.buffer);
    const objectKey = this.buildObjectKey(ctx, sourceId);
    await this.filesService.uploadPrivateBuffer({
      body: file.buffer,
      path: objectKey,
      contentType: BRIEFING_FILE_KIND_MIME[kind],
    });

    return this.sourceService.createSourceVersion(ctx, {
      sourceId,
      kind: LeadFlowBriefingSourceKind.Upload,
      objectKey,
      mimeType: BRIEFING_FILE_KIND_MIME[kind],
      byteSize: String(file.buffer.length),
      checksum,
      safeFilename: this.sanitizeFilename(file.originalname),
      createdById: ctx.userId ?? null,
      status: LeadFlowBriefingSourceVersionStatus.Available,
    });
  }

  async ingestUrl(
    ctx: RequestContext,
    sourceId: string,
    url: string,
  ): Promise<BriefingSourceVersionResponse> {
    const source = await this.resolveSource(ctx, sourceId);

    const maxBytes =
      this.configService.get<number>('leadflowBriefing.maxUrlFetchBytes') ?? 10 * 1024 * 1024;
    const timeoutMs =
      this.configService.get<number>('leadflowBriefing.urlFetchTimeoutMs') ?? 15000;

    const fetched = await this.ssrfSafeUrlFetcher.fetchUrl(url, { maxBytes, timeoutMs });

    const detectedKind = detectFileKind(fetched.body);
    const contentType = fetched.contentType?.split(';')[0]?.trim().toLowerCase() ?? null;
    const isTextual = contentType?.startsWith(TEXTUAL_CONTENT_TYPE_PREFIX) ?? false;

    if (detectedKind === 'unknown' && !isTextual) {
      throw new BadRequestException(
        'Unsupported content at that URL — expected a PDF, image, or web page.',
      );
    }

    await this.quotaService.assertWithinQuota(ctx, source.settingsId, fetched.body.length);
    await this.scanAndRejectIfUnsafe(fetched.body);

    const checksum = this.checksum(fetched.body);
    const mimeType =
      detectedKind !== 'unknown' ? BRIEFING_FILE_KIND_MIME[detectedKind] : (contentType ?? 'text/html');
    const objectKey = this.buildObjectKey(ctx, sourceId);
    await this.filesService.uploadPrivateBuffer({
      body: fetched.body,
      path: objectKey,
      contentType: mimeType,
    });

    return this.sourceService.createSourceVersion(ctx, {
      sourceId,
      kind: LeadFlowBriefingSourceKind.Url,
      objectKey,
      sourceUrl: url,
      mimeType,
      byteSize: String(fetched.body.length),
      checksum,
      createdById: ctx.userId ?? null,
      status: LeadFlowBriefingSourceVersionStatus.Available,
    });
  }

  async ingestPaste(
    ctx: RequestContext,
    sourceId: string,
    text: string,
  ): Promise<BriefingSourceVersionResponse> {
    const source = await this.resolveSource(ctx, sourceId);

    const maxBytes = this.configService.get<number>('leadflowBriefing.maxPasteBytes') ?? 200 * 1024;
    const buffer = Buffer.from(text, 'utf8');
    if (buffer.length === 0) {
      throw new BadRequestException('Pasted text is empty.');
    }
    if (buffer.length > maxBytes) {
      throw new BadRequestException('Pasted text exceeds the allowed size.');
    }

    await this.quotaService.assertWithinQuota(ctx, source.settingsId, buffer.length);
    await this.scanAndRejectIfUnsafe(buffer);

    return this.sourceService.createSourceVersion(ctx, {
      sourceId,
      kind: LeadFlowBriefingSourceKind.Paste,
      rawText: text,
      mimeType: 'text/plain',
      byteSize: String(buffer.length),
      checksum: this.checksum(buffer),
      createdById: ctx.userId ?? null,
      status: LeadFlowBriefingSourceVersionStatus.Available,
    });
  }

  private async resolveSource(
    ctx: RequestContext,
    sourceId: string,
  ): Promise<LeadFlowBriefingSourceEntity> {
    if (!ctx.workspaceId) {
      throw new BadRequestException('Workspace context is required.');
    }
    const source = await this.sourceRepository.findOne({
      where: { id: sourceId, tenantId: ctx.tenantId, workspaceId: ctx.workspaceId },
    });
    if (!source) {
      throw new NotFoundException('Briefing source not found.');
    }
    return source;
  }

  private async scanAndRejectIfUnsafe(buffer: Buffer): Promise<void> {
    let result;
    try {
      result = await this.scanner.scan(buffer);
    } catch {
      // Fail closed: a scanner that can't be reached is not the same as a
      // clean file. Never fall back to "assume safe" here.
      throw new BadRequestException('Content could not be scanned for malware — try again.');
    }
    if (!result.clean) {
      throw new BadRequestException('Content was rejected by the malware scanner.');
    }
  }

  private checksum(buffer: Buffer): string {
    return createHash('sha256').update(buffer).digest('hex');
  }

  private buildObjectKey(ctx: RequestContext, sourceId: string): string {
    return `tenants/${ctx.tenantId}/workspaces/${ctx.workspaceId}/leadflow-briefing/${sourceId}/${randomUUID()}`;
  }

  private sanitizeFilename(name: string): string {
    return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200);
  }
}
