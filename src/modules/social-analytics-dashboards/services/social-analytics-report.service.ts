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
import { DocumentLayoutsService } from '../../document-layouts/document-layouts.service';
import { DocumentPdfRendererService } from '../../document-layouts/document-pdf-renderer.service';
import { AgencyUserProfileEntity } from '../../agency/entities/agency-settings.entities';
import { SocialAnalyticsReportLogoService } from './social-analytics-report-logo.service';
import type { DashboardChannelId } from '../dashboard-layout.contract';
import { SocialAnalyticsReportEntity } from '../entities';
import {
  parseReportSnapshot,
  ReportSnapshotError,
  type ReportOrientation,
  type ReportPageMode,
  type ReportSnapshot,
} from '../report-snapshot.contract';
import {
  buildSocialAnalyticsReportHtml,
  type ReportLetterhead,
} from './social-analytics-report.renderer';

export type SocialAnalyticsReportView = {
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

export type RenderReportRequest = {
  title: string;
  dashboardId: string | null;
  channels: DashboardChannelId[];
  since: string;
  until: string;
  pageMode: ReportPageMode;
  orientation: ReportOrientation;
  issuedTimezone?: string;
  /** The dashboard as the operator sees it. See the contract module. */
  snapshot: unknown;
  /** Skips persistence — the preview renders the same PDF and stores nothing. */
  persist: boolean;
};

const MAX_REPORTS_PER_SCOPE = 200;

/**
 * Renders and records the Analytics report — Etapa 9.
 *
 * ## The archive stores the original emitted bytes
 *
 * Each successful emission goes to the private object bucket before its
 * database row is committed. The archive serves those bytes back; it never
 * rebuilds a document from a dashboard that may since have changed.
 *
 * ## The letterhead is server-side
 *
 * The body of the document comes from the client, because it has to look like
 * the screen it was exported from (see `report-snapshot.contract.ts`). The
 * header and footer do not: they are the agency's document model (Vendas ›
 * Layout de documentos, one per tenant and workspace), and the client's name
 * and logo come from the managed context and their Brand Kit. The masthead of a
 * document that gets forwarded to a client is exactly the part that must not be
 * settable by whatever posted the body.
 */
@Injectable()
export class SocialAnalyticsReportService {
  private readonly logger = new Logger(SocialAnalyticsReportService.name);

  constructor(
    @InjectRepository(SocialAnalyticsReportEntity, 'agency')
    private readonly reports: Repository<SocialAnalyticsReportEntity>,
    @InjectRepository(AgencyUserProfileEntity, 'agency')
    private readonly profiles: Repository<AgencyUserProfileEntity>,
    private readonly documentLayouts: DocumentLayoutsService,
    private readonly pdfRenderer: DocumentPdfRendererService,
    private readonly logos: SocialAnalyticsReportLogoService,
    private readonly files: FilesService,
  ) {}

  async list(scope: CompanyAwareScope): Promise<SocialAnalyticsReportView[]> {
    const rows = await this.reports.find({
      where: this.where(scope),
      order: { createdAt: 'DESC' },
      take: 60,
    });

    return rows.map((row) => this.toView(row));
  }

  /**
   * Builds the report's HTML. The preview and the export both go through here
   * and through `renderPdf`, so what the operator approves in the overlay is
   * the document that is printed.
   */
  private async build(
    ctx: RequestContext,
    request: RenderReportRequest,
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

    const { letterhead, logoUrl } = await this.resolveLetterhead(ctx, scope);

    return {
      title,
      logoUrl,
      html: buildSocialAnalyticsReportHtml({
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
   * Renders the PDF and, unless this is a preview, records the emission.
   *
   * The row is written *after* a successful render. A report that failed to
   * generate is not a report the client ever received, and listing it in the
   * Relatórios tab would offer a reprint of something that never existed.
   */
  async renderPdf(
    ctx: RequestContext,
    request: RenderReportRequest,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const scope = resolveCompanyAwareScope(ctx);
    const { html, title, logoUrl } = await this.build(ctx, request);

    const buffer = await this.pdfRenderer.renderHtmlToPdf(html, {
      format: 'A4',
      // The document's `@page` sets the size, the orientation and the margins
      // the footer is printed in; margins here would compound with those.
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
        this.filename(title, request),
      );
    }

    return { buffer, filename: this.filename(title, request) };
  }

  private async record(
    scope: CompanyAwareScope,
    actorId: string | null,
    request: RenderReportRequest,
    title: string,
    buffer: Buffer,
    filename: string,
  ): Promise<void> {
    const id = randomUUID();
    const storageKey = this.storageKey(scope, id);
    const issuedByName = await this.resolveActorName(scope.tenantId, actorId);
    const issuedTimezone = normalizeTimezone(request.issuedTimezone);

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
            `Failed to clean up Social Analytics report ${id}: ${
              cleanupError instanceof Error
                ? cleanupError.message
                : String(cleanupError)
            }`,
          ),
        );
      throw error;
    }

    // Retention must not turn a successfully archived emission into a failed
    // download. A later emission retries this cleanup, while this row keeps
    // pointing at the original PDF that has already been stored.
    await this.prune(scope).catch((error) =>
      this.logger.error(
        `Failed to prune Social Analytics reports for tenant=${scope.tenantId}: ${
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
        this.filename(report.title, {
          since: report.periodSince,
          until: report.periodUntil,
        }),
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
      'social-analytics-reports',
      scope.tenantId,
      scope.workspaceId,
      scope.agencyClientId ?? 'agency',
      scope.companyContextId ?? 'root',
      `${id}.pdf`,
    ].join('/');
  }

  /**
   * The agency's document model, plus the client the data belongs to.
   *
   * The model is the one Vendas › Layout de documentos edits: the default
   * layout of this tenant and workspace, with the company data filled from the
   * workspace settings where the layout leaves it blank, and the CSS of the
   * template it picked.
   *
   * The client's company is the selected company context when there is one,
   * otherwise the client itself. Their logo comes from the Brand Kit, inlined as
   * a `data:` URI (see `SocialAnalyticsReportLogoService`). Neither is asked for
   * in agency scope, where the Brand Kit would answer with the agency's own kit
   * and the agency would appear as the subject of its own report.
   */
  private async resolveLetterhead(
    ctx: RequestContext,
    scope: CompanyAwareScope,
  ): Promise<{ letterhead: ReportLetterhead; logoUrl: string | null }> {
    const clientName =
      ctx.managedContext?.companyName?.trim() ||
      ctx.managedContext?.clientName?.trim() ||
      null;

    const [layout, clientLogoUrl] = await Promise.all([
      this.documentLayouts.getDefaultLayout({
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
      }),
      clientName ? this.logos.resolveClientLogo(ctx) : Promise.resolve(null),
    ]);
    const template = await this.documentLayouts.getSystemTemplateForType(
      layout.layoutType,
    );
    const chrome = this.pdfRenderer.buildLayoutChrome(layout, template);

    return {
      logoUrl: chrome.logoUrl,
      letterhead: {
        layoutType: layout.layoutType,
        layoutCss: chrome.css,
        headerHtml: chrome.headerHtml,
        footerHtml: chrome.footerHtml,
        footerText:
          layout.footerText?.trim() || layout.companyName?.trim() || '',
        fontFamily: layout.fontFamily || 'Inter',
        headingFontFamily: layout.headingFontFamily || 'Sora',
        clientName,
        // Null is expected, not a failure: a client with no Brand Kit logo
        // gets their name and no mark.
        clientLogoUrl,
      },
    };
  }

  /** A filename an operator can find again in a downloads folder. */
  private filename(
    title: string,
    request: Pick<RenderReportRequest, 'since' | 'until'>,
  ): string {
    const slug =
      title
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-zA-Z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase()
        .slice(0, 60) || 'relatorio';

    return `${slug}-${request.since}-${request.until}.pdf`;
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

  private toView(row: SocialAnalyticsReportEntity): SocialAnalyticsReportView {
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

function normalizeTimezone(value: string | undefined): string {
  const timezone = value?.trim() || 'UTC';
  try {
    Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
    return timezone;
  } catch {
    return 'UTC';
  }
}

/**
 * What the report may load while Chromium renders it.
 *
 * The body is operator-supplied markup, so by default nothing is fetched: the
 * client inlines every image it can as a `data:` URI, and those never touch the
 * network. Two exceptions remain. The agency logo is a URL of this API, allowed
 * exactly. Meta's CDN serves the reel thumbnails the browser could not inline
 * (it does not send CORS headers), and is allowed by host, over HTTPS only.
 * Everything else, internal addresses included, is refused.
 */
export function isAllowedReportRequest(
  url: string,
  logoUrl: string | null,
): boolean {
  if (logoUrl && url === logoUrl) return true;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'https:') return false;

  const host = parsed.hostname.toLowerCase();

  return META_CDN_HOSTS.some(
    (suffix) => host === suffix || host.endsWith(`.${suffix}`),
  );
}

const META_CDN_HOSTS = ['fbcdn.net', 'cdninstagram.com'];
