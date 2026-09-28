import { Readable } from 'stream';
import { SocialAnalyticsReportService } from './social-analytics-report.service';

const scope = {
  tenantId: 'tenant-1',
  workspaceId: 'workspace-1',
  agencyClientId: 'client-1',
  companyContextId: 'company-1',
} as never;

const request = {
  title: 'Resultados de setembro',
  dashboardId: 'dashboard-1',
  channels: ['meta_ads'],
  since: '2026-09-01',
  until: '2026-09-30',
  pageMode: 'paginated',
  orientation: 'landscape',
  issuedTimezone: 'America/Sao_Paulo',
  snapshot: {},
  persist: true,
} as never;

function fixture() {
  const reports = {
    create: jest.fn((value) => value),
    save: jest.fn().mockResolvedValue(undefined),
    count: jest.fn().mockResolvedValue(1),
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn(),
    remove: jest.fn().mockResolvedValue(undefined),
  };
  const profiles = {
    findOne: jest.fn().mockResolvedValue({
      displayName: 'Ana Silva',
      email: 'ana@lyra.dev',
    }),
  };
  const files = {
    uploadPrivateBuffer: jest.fn().mockResolvedValue({ path: 'stored.pdf' }),
    getPrivateAsset: jest.fn(),
    deleteObject: jest.fn().mockResolvedValue(undefined),
  };
  const service = new SocialAnalyticsReportService(
    reports as never,
    profiles as never,
    {} as never,
    {} as never,
    {} as never,
    files as never,
  );

  return { service, reports, profiles, files };
}

describe('SocialAnalyticsReportService stored files', () => {
  it('uploads the original PDF privately before saving its immutable archive row', async () => {
    const { service, reports, profiles, files } = fixture();

    await service['record'](
      scope,
      'user-1',
      request,
      'Resultados de setembro',
      Buffer.from('%PDF-1.7'),
      'resultados-2026-09-01-2026-09-30.pdf',
    );

    expect(files.uploadPrivateBuffer).toHaveBeenCalledWith(
      expect.objectContaining({
        body: Buffer.from('%PDF-1.7'),
        contentType: 'application/pdf',
        path: expect.stringMatching(
          /^social-analytics-reports\/tenant-1\/workspace-1\/client-1\/company-1\/[\w-]+\.pdf$/,
        ),
      }),
    );
    expect(profiles.findOne).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1', userId: 'user-1' },
      select: { displayName: true, email: true },
    });
    expect(reports.save).toHaveBeenCalledWith(
      expect.objectContaining({
        issuedByName: 'Ana Silva',
        issuedTimezone: 'America/Sao_Paulo',
        fileName: 'resultados-2026-09-01-2026-09-30.pdf',
        storageKey: expect.stringContaining('social-analytics-reports/'),
      }),
    );
  });

  it('reads only a file row inside the resolved report scope', async () => {
    const { service, reports, files } = fixture();
    const stream = Readable.from(Buffer.from('%PDF-1.7'));
    reports.findOne.mockResolvedValue({
      id: 'report-1',
      title: 'Resultados',
      storageKey: 'social-analytics-reports/tenant-1/report-1.pdf',
      fileName: 'resultados.pdf',
    });
    files.getPrivateAsset.mockResolvedValue({
      body: stream,
      contentType: 'application/pdf',
    });

    await expect(service.getFile(scope, 'report-1')).resolves.toEqual({
      body: stream,
      contentType: 'application/pdf',
      filename: 'resultados.pdf',
    });
    expect(reports.findOne).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'report-1',
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        agencyClientId: 'client-1',
        companyContextId: 'company-1',
      }),
    });
  });
});
