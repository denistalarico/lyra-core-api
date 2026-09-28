import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import {
  resolveCompanyAwareScope,
  type CompanyAwareScope,
} from '../../../common/context/company-aware-scope';
import type { RequestContext } from '../../../common/context/request-context.interface';
import { DocumentLayoutsService } from '../../document-layouts/document-layouts.service';
import { DocumentPdfRendererService } from '../../document-layouts/document-pdf-renderer.service';
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
};

export type RenderReportRequest = {
  title: string;
  dashboardId: string | null;
  channels: DashboardChannelId[];
  since: string;
  until: string;
  pageMode: ReportPageMode;
  orientation: ReportOrientation;
  /** The dashboard as the operator sees it. See the contract module. */
  snapshot: unknown;
  /** Skips persistence — the preview asks for HTML and stores nothing. */
  persist: boolean;
};

const MAX_REPORTS_PER_SCOPE = 200;

/**
 * Renders and records the Analytics report — Etapa 9.
 *
 * ## What is and is not stored — a decided MVP scope, not a gap
 *
 * A row per emission, holding the title, channels, period and page mode; the
 * PDF bytes are streamed to the caller and **not** written to disk. `file_url`
 * stays null, and the archive is a record of what was emitted rather than a
 * file cabinet.
 *
 * This is a product decision taken for this first MVP, not an unfinished
 * feature. Two things follow from it and are deliberate:
 *
 * 1. There is no "reprint the original" action. Re-rendering would build the
 *    document from the dashboard *as it stands now*, which for a dashboard
 *    edited since is a different document under the original's name. Offering
 *    a reprint button would be claiming a fidelity nothing here can check.
 * 2. `file_url` is kept on the entity anyway, because the day a blob store is
 *    wired in, that column is where the object key goes — and adding it later
 *    would mean altering a table that already holds rows.
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
    private readonly documentLayouts: DocumentLayoutsService,
    private readonly pdfRenderer: DocumentPdfRendererService,
    private readonly logos: SocialAnalyticsReportLogoService,
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
   * Builds the report's HTML.
   *
   * Shared by the preview and the PDF so that what the operator approves in the
   * overlay is the same document that is printed — a preview rendered by a
   * second code path would eventually stop matching, and the whole point of the
   * step is to decide whether to send this exact thing.
   */
  async renderHtml(
    ctx: RequestContext,
    request: RenderReportRequest,
  ): Promise<{ html: string; title: string }> {
    const { html, title } = await this.build(ctx, request);

    return { html, title };
  }

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
      await this.record(scope, ctx.userId ?? null, request, title);
    }

    return { buffer, filename: this.filename(title, request) };
  }

  private async record(
    scope: CompanyAwareScope,
    actorId: string | null,
    request: RenderReportRequest,
    title: string,
  ): Promise<void> {
    try {
      const total = await this.reports.count({ where: this.where(scope) });

      // The archive is a log, and a log that grows without bound eventually
      // makes the tab unusable. The oldest rows go rather than the emission
      // being refused: refusing would block an export the operator needs now
      // because of one they made months ago.
      if (total >= MAX_REPORTS_PER_SCOPE) {
        const oldest = await this.reports.find({
          where: this.where(scope),
          order: { createdAt: 'ASC' },
          take: total - MAX_REPORTS_PER_SCOPE + 1,
        });

        if (oldest.length > 0) await this.reports.remove(oldest);
      }

      await this.reports.save(
        this.reports.create({
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
          createdById: actorId,
        }),
      );
    } catch (error) {
      // The PDF is already rendered and about to be streamed. Failing the
      // request now would deny the operator a document that exists, over a
      // bookkeeping row — so the failure is logged and the download proceeds.
      this.logger.error(
        `Failed to record social analytics report for tenant=${scope.tenantId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async remove(scope: CompanyAwareScope, id: string): Promise<void> {
    const report = await this.reports.findOne({
      where: { ...this.where(scope), id },
    });

    if (!report) return;

    await this.reports.remove(report);
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
  private filename(title: string, request: RenderReportRequest): string {
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
    };
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
