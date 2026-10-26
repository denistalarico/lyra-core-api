import { BadRequestException } from '@nestjs/common';
import { Readable } from 'stream';
import type { RequestContext } from '../../../common/context/request-context.interface';
import { REPORT_SNAPSHOT_VERSION } from '../../analytics-reports/report-snapshot.contract';
import { LeadFlowAnalyticsSnapshotReportService } from './leadflow-analytics-snapshot-report.service';

const TENANT = '10000000-0000-4000-8000-000000000001';
const WORKSPACE = '20000000-0000-4000-8000-000000000001';
const CLIENT = '30000000-0000-4000-8000-000000000001';
const COMPANY = '31000000-0000-4000-8000-000000000001';
const USER = '50000000-0000-4000-8000-000000000001';

const companyCtx: RequestContext = {
  tenantId: TENANT,
  workspaceId: WORKSPACE,
  userId: USER,
  role: 'operator',
  managedContext: {
    productKey: 'leadflow',
    operatingMode: 'client',
    clientId: CLIENT,
    companyContextId: COMPANY,
    managedTenantId: null,
    companyName: 'Padaria Central',
  },
} as RequestContext;

const companyScope = {
  tenantId: TENANT,
  workspaceId: WORKSPACE,
  agencyClientId: CLIENT,
  companyContextId: COMPANY,
};

const snapshot = {
  version: REPORT_SNAPSHOT_VERSION,
  width: 1200,
  html: '<section data-report-channel="overview">Cards</section><section data-report-channel="commercial">Mais</section>',
  css: '.social-analytics-card { border-radius: 12px; }',
  rootAttributes: {},
};

function request(overrides: Record<string, unknown> = {}) {
  return {
    title: '  Resultados de setembro  ',
    dashboardId: '60000000-0000-4000-8000-000000000001',
    channels: ['overview', 'commercial'],
    since: '2026-09-01',
    until: '2026-09-30',
    pageMode: 'paginated',
    orientation: 'landscape',
    issuedTimezone: 'America/Sao_Paulo',
    snapshot,
    persist: true,
    ...overrides,
  } as never;
}

function fixture() {
  const reports = {
    create: jest.fn((value: unknown) => value),
    save: jest.fn().mockResolvedValue(undefined),
    count: jest.fn().mockResolvedValue(1),
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn(),
    remove: jest.fn().mockResolvedValue(undefined),
  };
  const profiles = {
    findOne: jest
      .fn()
      .mockResolvedValue({ displayName: 'Ana Silva', email: 'ana@lyra.dev' }),
  };
  const letterheads = {
    resolve: jest.fn().mockResolvedValue({
      logoUrl: 'https://api.lyra.dev/logo.png',
      letterhead: {
        layoutType: 'essence',
        layoutCss: '',
        headerHtml: '<header class="doc-header">Agência</header>',
        footerHtml: '<footer class="doc-footer">Rodapé</footer>',
        footerText: 'Agência',
        fontFamily: 'Inter',
        headingFontFamily: 'Sora',
        clientName: 'Padaria Central',
        clientLogoUrl: null,
      },
    }),
  };
  const pdfRenderer = {
    renderHtmlToPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.7')),
  };
  const files = {
    uploadPrivateBuffer: jest.fn().mockResolvedValue({ path: 'stored.pdf' }),
    getPrivateAsset: jest.fn(),
    deleteObject: jest.fn().mockResolvedValue(undefined),
  };
  const service = new LeadFlowAnalyticsSnapshotReportService(
    reports as never,
    profiles as never,
    letterheads as never,
    pdfRenderer as never,
    files as never,
  );

  return { service, reports, profiles, letterheads, pdfRenderer, files };
}

describe('LeadFlowAnalyticsSnapshotReportService — validation', () => {
  it('refuses a blank title before rendering', async () => {
    const { service, pdfRenderer } = fixture();

    await expect(
      service.renderPdf(companyCtx, request({ title: '   ' })),
    ).rejects.toThrow(
      new BadRequestException('Informe um título para o relatório.'),
    );
    expect(pdfRenderer.renderHtmlToPdf).not.toHaveBeenCalled();
  });

  it('refuses an inverted period', async () => {
    const { service, pdfRenderer } = fixture();

    await expect(
      service.renderPdf(
        companyCtx,
        request({ since: '2026-09-30', until: '2026-09-01' }),
      ),
    ).rejects.toThrow('O início do período não pode ser posterior ao fim.');
    expect(pdfRenderer.renderHtmlToPdf).not.toHaveBeenCalled();
  });

  it.each([
    ['not an object', 'x'],
    ['wrong version', { ...snapshot, version: 1 }],
    ['empty html', { ...snapshot, html: '   ' }],
    ['script tag', { ...snapshot, html: '<script>alert(1)</script>' }],
  ])('turns an invalid snapshot (%s) into a 400', async (_label, value) => {
    const { service, pdfRenderer } = fixture();

    await expect(
      service.renderPdf(companyCtx, request({ snapshot: value })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(pdfRenderer.renderHtmlToPdf).not.toHaveBeenCalled();
  });
});

describe('LeadFlowAnalyticsSnapshotReportService — rendering and archive', () => {
  it('a preview renders the same document and stores nothing', async () => {
    const { service, reports, files, pdfRenderer, letterheads } = fixture();

    const result = await service.renderPdf(
      companyCtx,
      request({ persist: false }),
    );

    expect(result.filename).toBe(
      'resultados-de-setembro-2026-09-01-2026-09-30.pdf',
    );
    expect(letterheads.resolve).toHaveBeenCalledWith(companyCtx, companyScope);
    const [html, options] = pdfRenderer.renderHtmlToPdf.mock.calls[0] as [
      string,
      { untrusted: { allowRequest: (url: string) => boolean } },
    ];
    expect(html).toContain('data-report-channel="commercial"');
    expect(html).toContain('<title>Resultados de setembro</title>');
    expect(
      options.untrusted.allowRequest('https://api.lyra.dev/logo.png'),
    ).toBe(true);
    expect(options.untrusted.allowRequest('http://169.254.169.254/')).toBe(
      false,
    );
    expect(files.uploadPrivateBuffer).not.toHaveBeenCalled();
    expect(reports.save).not.toHaveBeenCalled();
  });

  it('an export uploads the PDF under the LeadFlow prefix, then records it in the company scope', async () => {
    const { service, reports, files } = fixture();

    await service.renderPdf(companyCtx, request());

    const [upload] = files.uploadPrivateBuffer.mock.calls[0] as [
      { path: string; contentType: string },
    ];
    expect(upload.contentType).toBe('application/pdf');
    expect(upload.path).toMatch(
      new RegExp(
        `^leadflow-analytics-reports/${TENANT}/${WORKSPACE}/${CLIENT}/${COMPANY}/[\\w-]+\\.pdf$`,
      ),
    );
    expect(reports.save).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT,
        workspaceId: WORKSPACE,
        agencyClientId: CLIENT,
        companyContextId: COMPANY,
        title: 'Resultados de setembro',
        channels: ['overview', 'commercial'],
        createdById: USER,
        issuedByName: 'Ana Silva',
        issuedTimezone: 'America/Sao_Paulo',
        fileName: 'resultados-de-setembro-2026-09-01-2026-09-30.pdf',
      }),
    );
  });

  it('agency root keys the file under agency/root', async () => {
    const { service, files } = fixture();
    const agencyCtx = {
      tenantId: TENANT,
      workspaceId: WORKSPACE,
      userId: USER,
      role: 'operator',
    } as RequestContext;

    await service.renderPdf(agencyCtx, request());

    const [upload] = files.uploadPrivateBuffer.mock.calls[0] as [
      { path: string },
    ];
    expect(upload.path).toMatch(
      new RegExp(
        `^leadflow-analytics-reports/${TENANT}/${WORKSPACE}/agency/root/`,
      ),
    );
  });

  it('removes the stored object when the row cannot be saved', async () => {
    const { service, reports, files } = fixture();
    reports.save.mockRejectedValueOnce(new Error('db down'));

    await expect(service.renderPdf(companyCtx, request())).rejects.toThrow(
      'db down',
    );
    const uploaded = (
      files.uploadPrivateBuffer.mock.calls[0] as [{ path: string }]
    )[0].path;
    expect(files.deleteObject).toHaveBeenCalledWith({
      bucket: 'private',
      path: uploaded,
    });
  });

  it('prunes the scope down to 200 emissions, oldest first', async () => {
    const { service, reports, files } = fixture();
    reports.count.mockResolvedValue(202);
    reports.find.mockResolvedValue([
      { id: 'old-1', storageKey: 'leadflow-analytics-reports/old-1.pdf' },
      { id: 'old-2', storageKey: null },
    ]);

    await service.renderPdf(companyCtx, request());

    expect(reports.find).toHaveBeenCalledWith(
      expect.objectContaining({ order: { createdAt: 'ASC' }, take: 2 }),
    );
    expect(files.deleteObject).toHaveBeenCalledWith({
      bucket: 'private',
      path: 'leadflow-analytics-reports/old-1.pdf',
    });
    expect(reports.remove).toHaveBeenCalledTimes(2);
  });
});

describe('LeadFlowAnalyticsSnapshotReportService — scope', () => {
  it('lists at most 60 emissions of the scope, newest first', async () => {
    const { service, reports } = fixture();
    reports.find.mockResolvedValue([
      {
        id: 'r1',
        title: 'T',
        dashboardId: null,
        channels: ['service'],
        periodSince: '2026-09-01',
        periodUntil: '2026-09-30',
        pageMode: 'continuous',
        createdAt: new Date('2026-10-01T12:00:00Z'),
        issuedByName: 'Ana',
        issuedTimezone: 'UTC',
        storageKey: null,
      },
    ]);

    await expect(service.list(companyScope)).resolves.toEqual([
      expect.objectContaining({
        id: 'r1',
        createdAt: '2026-10-01T12:00:00.000Z',
        fileAvailable: false,
      }),
    ]);
    expect((reports.find.mock.calls[0] as unknown[])[0]).toMatchObject({
      where: {
        tenantId: TENANT,
        agencyClientId: CLIENT,
        companyContextId: COMPANY,
      },
      order: { createdAt: 'DESC' },
      take: 60,
    });
  });

  it('serves a file only from the resolved scope', async () => {
    const { service, reports, files } = fixture();
    const stream = Readable.from(Buffer.from('%PDF-1.7'));
    reports.findOne.mockResolvedValue({
      id: 'r1',
      title: 'Resultados',
      periodSince: '2026-09-01',
      periodUntil: '2026-09-30',
      storageKey: 'leadflow-analytics-reports/r1.pdf',
      fileName: null,
    });
    files.getPrivateAsset.mockResolvedValue({
      body: stream,
      contentType: 'application/pdf',
    });

    await expect(service.getFile(companyScope, 'r1')).resolves.toEqual({
      body: stream,
      contentType: 'application/pdf',
      filename: 'resultados-2026-09-01-2026-09-30.pdf',
    });
    expect((reports.findOne.mock.calls[0] as unknown[])[0]).toMatchObject({
      where: { id: 'r1', agencyClientId: CLIENT, companyContextId: COMPANY },
    });
  });

  it('answers 404 for a report of another scope', async () => {
    const { service, reports } = fixture();
    reports.findOne.mockResolvedValue(null);

    await expect(service.getFile(companyScope, 'r1')).rejects.toThrow(
      'O arquivo deste relatório não está disponível.',
    );
  });

  it('removes the stored object and the row, and ignores unknown ids', async () => {
    const { service, reports, files } = fixture();
    reports.findOne.mockResolvedValueOnce({
      id: 'r1',
      storageKey: 'leadflow-analytics-reports/r1.pdf',
    });

    await service.remove(companyScope, 'r1');
    expect(files.deleteObject).toHaveBeenCalledWith({
      bucket: 'private',
      path: 'leadflow-analytics-reports/r1.pdf',
    });
    expect(reports.remove).toHaveBeenCalledTimes(1);

    reports.findOne.mockResolvedValueOnce(null);
    await service.remove(companyScope, 'other');
    expect(reports.remove).toHaveBeenCalledTimes(1);
  });
});
