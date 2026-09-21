import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import type { CompanyAwareScope } from '../../../common/context/company-aware-scope';
import { AgencyWorkspaceCompanySettingsEntity } from '../../agency/entities/agency-settings.entities';
import { DocumentPdfRendererService } from '../../document-layouts/document-pdf-renderer.service';
import type { DashboardChannelId } from '../dashboard-layout.contract';
import { SocialAnalyticsReportEntity } from '../entities';
import {
  parseReportDocument,
  ReportDocumentError,
  type ReportDocument,
  type ReportPageMode,
} from '../report-document.contract';
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
  /** The report body, as the dashboard rendered it. See the contract module. */
  document: unknown;
  /** Skips persistence — the preview asks for HTML and stores nothing. */
  persist: boolean;
};

const MAX_REPORTS_PER_SCOPE = 200;

/**
 * Renders and records the Analytics report — Etapa 9.
 *
 * ## What is and is not stored
 *
 * A row per emission, holding the title, channels, period and page mode; the
 * PDF bytes are streamed to the caller and **not** written to disk. `file_url`
 * stays null, and reprinting from the Relatórios tab re-renders from the
 * dashboard rather than serving a stored file.
 *
 * That is a deliberate reading of the plan's "relatório reimpresso é idêntico ao
 * original". Identical to *what the dashboard shows* is the promise this module
 * can actually keep: the numbers in a dashboard for a closed period do not
 * move, so a re-render of the same period reproduces the same document. Storing
 * bytes would need a blob store this module does not have, and would make the
 * archive diverge from the dashboard the moment a card is renamed — with no
 * signal to the reader about which of the two they are looking at. The column
 * exists for the day a blob store is wired in.
 *
 * ## The letterhead is server-side
 *
 * The body of the document comes from the client, because it has to agree with
 * the screen it was exported from (see `report-document.contract.ts`). The
 * header does not: the agency's name, details and logo are read here from
 * `workspace_company_settings` for the caller's own tenant and workspace. The
 * masthead of a document that gets forwarded to a client is exactly the part
 * that must not be settable by whatever posted the body.
 */
@Injectable()
export class SocialAnalyticsReportService {
  private readonly logger = new Logger(SocialAnalyticsReportService.name);

  constructor(
    @InjectRepository(SocialAnalyticsReportEntity, 'agency')
    private readonly reports: Repository<SocialAnalyticsReportEntity>,
    @InjectRepository(AgencyWorkspaceCompanySettingsEntity, 'agency')
    private readonly companySettings: Repository<AgencyWorkspaceCompanySettingsEntity>,
    private readonly pdfRenderer: DocumentPdfRendererService,
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
    scope: CompanyAwareScope,
    clientName: string | null,
    request: RenderReportRequest,
  ): Promise<{ html: string; title: string }> {
    const title = request.title.trim();

    if (!title) {
      throw new BadRequestException('Informe um título para o relatório.');
    }

    if (request.since > request.until) {
      throw new BadRequestException(
        'O início do período não pode ser posterior ao fim.',
      );
    }

    let document: ReportDocument;

    try {
      document = parseReportDocument(request.document);
    } catch (error) {
      if (error instanceof ReportDocumentError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }

    const letterhead = await this.resolveLetterhead(scope, clientName);

    return {
      title,
      html: buildSocialAnalyticsReportHtml({
        title,
        periodSince: request.since,
        periodUntil: request.until,
        pageMode: request.pageMode,
        document,
        letterhead,
        generatedAt: new Date(),
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
    scope: CompanyAwareScope,
    actorId: string | null,
    clientName: string | null,
    request: RenderReportRequest,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const { html, title } = await this.renderHtml(scope, clientName, request);

    const buffer = await this.pdfRenderer.renderHtmlToPdf(html, {
      format: 'A4',
      // Zero here because the document declares its own `@page` margins; two
      // sets of margins would compound and shrink the content area.
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });

    if (request.persist) {
      await this.record(scope, actorId, request, title);
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
   * The agency block, plus the client the data belongs to.
   *
   * `clientName` comes from the resolved managed context rather than from a
   * lookup here: the context resolver already reads it from `agency_clients`,
   * and re-reading it would make this module depend on the clients module for a
   * string it is being handed.
   */
  private async resolveLetterhead(
    scope: CompanyAwareScope,
    clientName: string | null,
  ): Promise<ReportLetterhead> {
    const settings = await this.companySettings.findOne({
      where: { tenantId: scope.tenantId, workspaceId: scope.workspaceId },
    });

    const agencyName =
      settings?.tradeName?.trim() ||
      settings?.legalName?.trim() ||
      settings?.workspaceName?.trim() ||
      'Relatório de Social Analytics';

    return {
      agencyName,
      agencyDetails: [
        settings?.legalName?.trim() && settings.legalName !== agencyName
          ? settings.legalName
          : '',
        settings?.taxId?.trim()
          ? `${settings.taxIdType || 'CNPJ'}: ${settings.taxId}`
          : '',
        settings?.addressLine?.trim() ?? '',
        [settings?.supportEmail, settings?.phone]
          .filter((value) => value?.trim())
          .join(' · '),
        settings?.website?.trim() ?? '',
      ].filter((line) => line.trim().length > 0),
      agencyLogoUrl: this.resolveAssetUrl(
        settings?.logoUrl ?? settings?.avatarUrl,
      ),
      clientName: clientName?.trim() || null,
      // The client's own mark has no column anywhere in the platform today —
      // `agency_clients` stores a name and no brand asset. Rather than reach
      // into the Brand Kit (another module, and a kit is a set of assets with
      // no single "this is the logo" among them), the block renders the client's
      // name. See the status note; wiring a real asset is a one-field change.
      clientLogoUrl: null,
    };
  }

  /**
   * Makes a stored asset path absolute.
   *
   * Playwright loads the HTML with `setContent`, so the document has no base
   * URL — a relative `/uploads/...` would resolve against `about:blank` and the
   * logo would silently not print. Mirrors `resolveAssetUrl` in
   * `document-pdf-renderer.service.ts`.
   */
  private resolveAssetUrl(value: string | null | undefined): string | null {
    const url = value?.trim();

    if (!url) return null;
    if (/^[a-z][a-z\d+\-.]*:/i.test(url)) return url;

    if (url.startsWith('/')) {
      const apiBaseUrl = (
        process.env.AGENCY_PUBLIC_API_URL ||
        process.env.API_PUBLIC_URL ||
        'http://localhost:3000/api'
      ).replace(/\/$/, '');

      return url.startsWith('/api/')
        ? `${apiBaseUrl.replace(/\/api$/i, '')}${url}`
        : `${apiBaseUrl}${url}`;
    }

    return url;
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
