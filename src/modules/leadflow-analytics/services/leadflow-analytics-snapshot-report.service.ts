import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import type { Readable } from 'stream';
import { FilesService } from '../../../common/files/files.service';
import {
  resolveCompanyAwareScope,
  type CompanyAwareScope,
} from '../../../common/context/company-aware-scope';
import type { RequestContext } from '../../../common/context/request-context.interface';
import { DocumentPdfRendererService } from '../../document-layouts/document-pdf-renderer.service';
import { AgencyUserProfileEntity } from '../../agency/entities/agency-settings.entities';
import { AnalyticsReportLetterheadService } from '../../analytics-reports/analytics-report-letterhead.service';
import { buildAnalyticsReportHtml } from '../../analytics-reports/analytics-report.renderer';
import {
  analyticsReportFilename,
  isAllowedReportRequest,
  normalizeReportTimezone,
} from '../../analytics-reports/analytics-report.helpers';
import {
  parseReportSnapshot,
  ReportSnapshotError,
  type ReportOrientation,
  type ReportPageMode,
  type ReportSnapshot,
} from '../../analytics-reports/report-snapshot.contract';
import type { DashboardChannelId } from '../dashboards/dashboard-layout.contract';
import { LeadFlowAnalyticsReportEntity } from '../entities';

export type LeadFlowAnalyticsReportView = {
  id: string;
  title: string;
  dashboardId: string | null;
  channels: DashboardChannelId[];
  periodSince: string;
  periodUntil: string;
  pageMode: ReportPageMode;
  createdAt: string;
  issuedByName: string | null;
  issuedTimezone: string | null;
  fileAvailable: boolean;
};

export type RenderLeadFlowReportRequest = {
  title: string;
  dashboardId: string | null;
  channels: DashboardChannelId[];
  since: string;
  until: string;
  pageMode: ReportPageMode;
  orientation: ReportOrientation;
  issuedTimezone?: string;
  /** The dashboard as the operator sees it (`report-snapshot.contract`). */
  snapshot: unknown;
  /** Skips persistence — the preview renders the same PDF and stores nothing. */
  persist: boolean;
};

const MAX_REPORTS_PER_SCOPE = 200;

/**
 * Renders and records the LeadFlow Analytics report — AN-LF2.
 *
 * A structural copy of `SocialAnalyticsReportService` (D-AN-5): the body is the
 * DOM snapshot of the dashboard, the header and footer are the agency's
 * document model (`AnalyticsReportLetterheadService`), and the archive keeps
 * the original emitted bytes in the private bucket. Only the table, the storage
 * prefix and the channel ids are LeadFlow's.
 */
@Injectable()
export class LeadFlowAnalyticsSnapshotReportService {
  private readonly logger = new Logger(
    LeadFlowAnalyticsSnapshotReportService.name,
  );

  constructor(
    @InjectRepository(LeadFlowAnalyticsReportEntity, 'agency')
    private readonly reports: Repository<LeadFlowAnalyticsReportEntity>,
    @InjectRepository(AgencyUserProfileEntity, 'agency')
    private readonly profiles: Repository<AgencyUserProfileEntity>,
    private readonly letterheads: AnalyticsReportLetterheadService,
    private readonly pdfRenderer: DocumentPdfRendererService,
    private readonly files: FilesService,
  ) {}

  async list(scope: CompanyAwareScope): Promise<LeadFlowAnalyticsReportView[]> {
    const rows = await this.reports.find({
      where: this.where(scope),
      order: { createdAt: 'DESC' },
      take: 60,
    });

    return rows.map((row) => this.toView(row));
  }

  /** The preview and the export both go through here and through `renderPdf`. */
  private async build(
    ctx: RequestContext,
    request: RenderLeadFlowReportRequest,
  ): Promise<{ html: string; title: string; logoUrl: string | null }> {
    const scope = resolveCompanyAwareScope(ctx);
    const title = request.title.trim();

    if (!title) {
      throw new BadRequestException('Informe um título para o relatório.');
    }

    if (request.since > request.until) {
      throw new BadRequestException(
        'O início do período não pode ser posterior ao fim.',
      );
    }

    let snapshot: ReportSnapshot;

    try {
      snapshot = parseReportSnapshot(request.snapshot);
    } catch (error) {
      if (error instanceof ReportSnapshotError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }

    const { letterhead, logoUrl } = await this.letterheads.resolve(ctx, scope);

    return {
      title,
      logoUrl,
      html: buildAnalyticsReportHtml({
        title,
        periodSince: request.since,
        periodUntil: request.until,
        pageMode: request.pageMode,
        orientation: request.orientation,
        snapshot,
        letterhead,
      }),
    };
  }

  /**
   * Renders the PDF and, unless this is a preview, records the emission —
   * after a successful render, so the archive never lists a failed one.
   */
  async renderPdf(
    ctx: RequestContext,
    request: RenderLeadFlowReportRequest,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const scope = resolveCompanyAwareScope(ctx);
    const { html, title, logoUrl } = await this.build(ctx, request);
    const filename = analyticsReportFilename(
      title,
      request.since,
      request.until,
    );

    const buffer = await this.pdfRenderer.renderHtmlToPdf(html, {
      format: 'A4',
      // The document's `@page` sets the size, the orientation and the margins.
      preferCSSPageSize: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
      untrusted: {
        allowRequest: (url) => isAllowedReportRequest(url, logoUrl),
      },
    });

    if (request.persist) {
      await this.record(
        scope,
        ctx.userId ?? null,
        request,
        title,
        buffer,
        filename,
      );
    }

    return { buffer, filename };
  }

  private async record(
    scope: CompanyAwareScope,
    actorId: string | null,
    request: RenderLeadFlowReportRequest,
    title: string,
    buffer: Buffer,
    filename: string,
  ): Promise<void> {
    const id = randomUUID();
    const storageKey = this.storageKey(scope, id);
    const issuedByName = await this.resolveActorName(scope.tenantId, actorId);
    const issuedTimezone = normalizeReportTimezone(request.issuedTimezone);

    await this.files.uploadPrivateBuffer({
      body: buffer,
      path: storageKey,
      contentType: 'application/pdf',
    });

    try {
      await this.reports.save(
        this.reports.create({
          id,
          tenantId: scope.tenantId,
          workspaceId: scope.workspaceId,
          agencyClientId: scope.agencyClientId,
          companyContextId: scope.companyContextId,
          dashboardId: request.dashboardId,
          title,
          channels: request.channels,
          periodSince: request.since,
          periodUntil: request.until,
          pageMode: request.pageMode,
          fileUrl: null,
          storageKey,
          fileName: filename,
          createdById: actorId,
          issuedByName,
          issuedTimezone,
        }),
      );
    } catch (error) {
      await this.files
        .deleteObject({ bucket: 'private', path: storageKey })
        .catch((cleanupError) =>
          this.logger.error(
            `Failed to clean up LeadFlow Analytics report ${id}: ${
              cleanupError instanceof Error
                ? cleanupError.message
                : String(cleanupError)
            }`,
          ),
        );
      throw error;
    }

    // Retention must not turn a successfully archived emission into a failed
    // download; a later emission retries the cleanup.
    await this.prune(scope).catch((error) =>
      this.logger.error(
        `Failed to prune LeadFlow Analytics reports for tenant=${scope.tenantId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      ),
    );
  }

  async getFile(
    scope: CompanyAwareScope,
    id: string,
  ): Promise<{ body: Readable; contentType: string; filename: string }> {
    const report = await this.reports.findOne({
      where: { ...this.where(scope), id },
    });

    if (!report?.storageKey) {
      throw new NotFoundException(
        'O arquivo deste relatório não está disponível.',
      );
    }

    const asset = await this.files.getPrivateAsset(report.storageKey);
    return {
      body: asset.body,
      contentType: asset.contentType,
      filename:
        report.fileName ??
        analyticsReportFilename(
          report.title,
          report.periodSince,
          report.periodUntil,
        ),
    };
  }

  async remove(scope: CompanyAwareScope, id: string): Promise<void> {
    const report = await this.reports.findOne({
      where: { ...this.where(scope), id },
    });

    if (!report) return;

    if (report.storageKey) {
      await this.files.deleteObject({
        bucket: 'private',
        path: report.storageKey,
      });
    }

    await this.reports.remove(report);
  }

  private async prune(scope: CompanyAwareScope): Promise<void> {
    const total = await this.reports.count({ where: this.where(scope) });
    if (total <= MAX_REPORTS_PER_SCOPE) return;

    const oldest = await this.reports.find({
      where: this.where(scope),
      order: { createdAt: 'ASC' },
      take: total - MAX_REPORTS_PER_SCOPE,
    });

    for (const report of oldest) {
      if (report.storageKey) {
        await this.files.deleteObject({
          bucket: 'private',
          path: report.storageKey,
        });
      }
      await this.reports.remove(report);
    }
  }

  private async resolveActorName(
    tenantId: string,
    actorId: string | null,
  ): Promise<string> {
    if (!actorId) return 'Automação Lyra';

    const profile = await this.profiles.findOne({
      where: { tenantId, userId: actorId },
      select: { displayName: true, email: true },
    });

    return (
      profile?.displayName?.trim() ||
      profile?.email?.trim() ||
      'Usuário da agência'
    );
  }

  private storageKey(scope: CompanyAwareScope, id: string): string {
    return [
      'leadflow-analytics-reports',
      scope.tenantId,
      scope.workspaceId,
      scope.agencyClientId ?? 'agency',
      scope.companyContextId ?? 'root',
      `${id}.pdf`,
    ].join('/');
  }

  private where(scope: CompanyAwareScope) {
    return {
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      agencyClientId:
        scope.agencyClientId === null ? IsNull() : scope.agencyClientId,
      companyContextId:
        scope.companyContextId === null ? IsNull() : scope.companyContextId,
    };
  }

  private toView(
    row: LeadFlowAnalyticsReportEntity,
  ): LeadFlowAnalyticsReportView {
    return {
      id: row.id,
      title: row.title,
      dashboardId: row.dashboardId,
      channels: row.channels ?? [],
      periodSince: row.periodSince,
      periodUntil: row.periodUntil,
      pageMode: row.pageMode,
      createdAt: row.createdAt.toISOString(),
      issuedByName: row.issuedByName,
      issuedTimezone: row.issuedTimezone,
      fileAvailable: Boolean(row.storageKey),
    };
  }
}
