import { Injectable } from '@nestjs/common';
import type { CompanyAwareScope } from '../../common/context/company-aware-scope';
import type { RequestContext } from '../../common/context/request-context.interface';
import { DocumentLayoutsService } from '../document-layouts/document-layouts.service';
import { DocumentPdfRendererService } from '../document-layouts/document-pdf-renderer.service';
import { AnalyticsReportLogoService } from './analytics-report-logo.service';
import type { ReportLetterhead } from './analytics-report.renderer';

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
 * a `data:` URI (see `AnalyticsReportLogoService`). Neither is asked for in
 * agency scope, where the Brand Kit would answer with the agency's own kit and
 * the agency would appear as the subject of its own report.
 */
@Injectable()
export class AnalyticsReportLetterheadService {
  constructor(
    private readonly documentLayouts: DocumentLayoutsService,
    private readonly pdfRenderer: DocumentPdfRendererService,
    private readonly logos: AnalyticsReportLogoService,
  ) {}

  async resolve(
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
}
