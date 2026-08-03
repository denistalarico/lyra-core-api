import { randomUUID } from 'node:crypto';
import { AgencyDataSource } from '../../../database/agency-typeorm.datasource';
import { LeadFlowClientSettingsEntity } from '../../leadflow-settings/entities';
import { LeadFlowBusinessMode } from '../../leadflow-settings/enums/leadflow-business-mode.enum';
import { LeadFlowSettingsContextType } from '../../leadflow-settings/enums/leadflow-settings-context-type.enum';
import { LeadFlowBriefingSourceEntity, LeadFlowBriefingSourceVersionEntity } from '../entities';
import { LeadFlowBriefingSourceKind } from '../enums/leadflow-briefing-source-kind.enum';
import { LeadFlowBriefingSourceVersionStatus } from '../enums/leadflow-briefing-source-version-status.enum';
import type { MalwareScanResult, MalwareScannerAdapter } from './malware-scanner.adapter';
import { LeadFlowBriefingIngestionService } from './leadflow-briefing-ingestion.service';
import { LeadFlowBriefingQuotaService } from './leadflow-briefing-quota.service';
import { LeadFlowBriefingSourceService } from './leadflow-briefing-source.service';

const run = process.env.INBOX_PG_INTEGRATION === 'true' ? describe : describe.skip;

const PDF_BYTES = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(20, 0x20)]);

class FakeScanner implements MalwareScannerAdapter {
  mode: 'clean' | 'infected' | 'throw' = 'clean';
  async scan(): Promise<MalwareScanResult> {
    if (this.mode === 'throw') throw new Error('scanner_unreachable');
    if (this.mode === 'infected') return { clean: false, signature: 'Test-Signature' };
    return { clean: true };
  }
}

function fakeConfig(overrides: Record<string, number> = {}) {
  const defaults: Record<string, number> = {
    'leadflowBriefing.maxUploadBytes': 20 * 1024 * 1024,
    'leadflowBriefing.maxUrlFetchBytes': 10 * 1024 * 1024,
    'leadflowBriefing.maxPasteBytes': 200 * 1024,
    'leadflowBriefing.maxTotalBytesPerSettings': 200 * 1024 * 1024,
    'leadflowBriefing.urlFetchTimeoutMs': 15000,
    ...overrides,
  };
  return { get: (key: string) => defaults[key] } as never;
}

function fakeFilesService() {
  const uploaded: Array<{ path: string; contentType: string }> = [];
  return {
    uploaded,
    uploadPrivateBuffer: async (input: { path: string; contentType: string }) => {
      uploaded.push({ path: input.path, contentType: input.contentType });
      return { path: input.path };
    },
  };
}

run('LeadFlowBriefingIngestionService PostgreSQL', () => {
  const tenantId = randomUUID();
  const workspaceId = randomUUID();
  let settingsId: string;
  let quotaService: LeadFlowBriefingQuotaService;
  let sourceService: LeadFlowBriefingSourceService;

  const ctx = () => ({ tenantId, workspaceId, userId: randomUUID() });

  async function makeSource() {
    const source = await sourceService.createSource(ctx(), {
      settingsId,
      contextType: LeadFlowSettingsContextType.Agency,
      agencyClientId: null,
      kind: LeadFlowBriefingSourceKind.Upload,
      label: 'Ingestion test source',
      createdById: null,
    });
    return source.id;
  }

  function makeIngestionService(
    scanner: MalwareScannerAdapter,
    opts: {
      files?: ReturnType<typeof fakeFilesService>;
      fetcher?: { fetchUrl: jest.Mock };
      configOverrides?: Record<string, number>;
    } = {},
  ) {
    const files = opts.files ?? fakeFilesService();
    const fetcher = opts.fetcher ?? { fetchUrl: jest.fn() };
    const service = new LeadFlowBriefingIngestionService(
      fakeConfig(opts.configOverrides),
      files as never,
      sourceService,
      quotaService,
      fetcher as never,
      scanner,
      AgencyDataSource.getRepository(LeadFlowBriefingSourceEntity),
    );
    return { service, files, fetcher };
  }

  beforeAll(async () => {
    if (!AgencyDataSource.isInitialized) await AgencyDataSource.initialize();
    quotaService = new LeadFlowBriefingQuotaService(AgencyDataSource, fakeConfig());
    sourceService = new LeadFlowBriefingSourceService(AgencyDataSource);

    const settings = await AgencyDataSource.getRepository(LeadFlowClientSettingsEntity).save({
      tenantId,
      workspaceId,
      contextType: LeadFlowSettingsContextType.Agency,
      businessModeKey: LeadFlowBusinessMode.AgencyServices,
    });
    settingsId = settings.id;
  });

  afterAll(async () => {
    await AgencyDataSource.getRepository(LeadFlowBriefingSourceVersionEntity).delete({
      tenantId,
    });
    await AgencyDataSource.getRepository(LeadFlowBriefingSourceEntity).delete({ tenantId });
    await AgencyDataSource.getRepository(LeadFlowClientSettingsEntity).delete({ tenantId });
  });

  it('accepts a valid PDF upload and creates an available version with checksum/objectKey', async () => {
    const { service, files } = makeIngestionService(new FakeScanner());
    const sourceId = await makeSource();

    const version = await service.ingestUpload(ctx(), sourceId, {
      buffer: PDF_BYTES,
      mimetype: 'application/pdf',
      originalname: 'brief.pdf',
      size: PDF_BYTES.length,
    });

    expect(version.status).toBe(LeadFlowBriefingSourceVersionStatus.Available);
    expect(files.uploaded).toHaveLength(1);
    expect(files.uploaded[0].contentType).toBe('application/pdf');

    const stored = await AgencyDataSource.getRepository(LeadFlowBriefingSourceVersionEntity).findOne({
      where: { id: version.id },
    });
    expect(stored?.objectKey).toBe(files.uploaded[0].path);
    expect(stored?.checksum).toHaveLength(64); // sha256 hex
  });

  it('rejects content whose magic bytes do not match any allowed kind — before any row/object is created', async () => {
    const { service, files } = makeIngestionService(new FakeScanner());
    const sourceId = await makeSource();

    await expect(
      service.ingestUpload(ctx(), sourceId, {
        buffer: Buffer.from('not actually a pdf'),
        mimetype: 'application/pdf',
        originalname: 'fake.pdf',
        size: 19,
      }),
    ).rejects.toThrow();

    expect(files.uploaded).toHaveLength(0);
    const count = await AgencyDataSource.getRepository(LeadFlowBriefingSourceVersionEntity).count({
      where: { sourceId },
    });
    expect(count).toBe(0);
  });

  it('rejects an oversized upload before scanning or storing', async () => {
    const { service, files } = makeIngestionService(new FakeScanner(), {
      configOverrides: { 'leadflowBriefing.maxUploadBytes': 10 },
    });
    const sourceId = await makeSource();

    await expect(
      service.ingestUpload(ctx(), sourceId, {
        buffer: PDF_BYTES,
        mimetype: 'application/pdf',
        originalname: 'brief.pdf',
        size: PDF_BYTES.length,
      }),
    ).rejects.toThrow(/exceeds the allowed size/);
    expect(files.uploaded).toHaveLength(0);
  });

  it('rejects content flagged infected by the scanner', async () => {
    const scanner = new FakeScanner();
    scanner.mode = 'infected';
    const { service, files } = makeIngestionService(scanner);
    const sourceId = await makeSource();

    await expect(
      service.ingestUpload(ctx(), sourceId, {
        buffer: PDF_BYTES,
        mimetype: 'application/pdf',
        originalname: 'brief.pdf',
        size: PDF_BYTES.length,
      }),
    ).rejects.toThrow(/rejected by the malware scanner/);
    expect(files.uploaded).toHaveLength(0);
  });

  it('fails closed when the scanner cannot be reached', async () => {
    const scanner = new FakeScanner();
    scanner.mode = 'throw';
    const { service, files } = makeIngestionService(scanner);
    const sourceId = await makeSource();

    await expect(
      service.ingestUpload(ctx(), sourceId, {
        buffer: PDF_BYTES,
        mimetype: 'application/pdf',
        originalname: 'brief.pdf',
        size: PDF_BYTES.length,
      }),
    ).rejects.toThrow(/could not be scanned/);
    expect(files.uploaded).toHaveLength(0);
  });

  it('stores pasted text directly as rawText with no object upload', async () => {
    const { service, files } = makeIngestionService(new FakeScanner());
    const sourceId = await makeSource();

    const version = await service.ingestPaste(
      ctx(),
      sourceId,
      'Our company sells widgets to other businesses.',
    );

    expect(version.status).toBe(LeadFlowBriefingSourceVersionStatus.Available);
    expect(files.uploaded).toHaveLength(0);
    const stored = await AgencyDataSource.getRepository(LeadFlowBriefingSourceVersionEntity).findOne({
      where: { id: version.id },
    });
    expect(stored?.rawText).toBe('Our company sells widgets to other businesses.');
    expect(stored?.objectKey).toBeNull();
  });

  it('fetches, validates, and stores a URL source via the injected fetcher', async () => {
    const fetcher = {
      fetchUrl: jest.fn().mockResolvedValue({ body: PDF_BYTES, contentType: 'application/pdf' }),
    };
    const { service, files } = makeIngestionService(new FakeScanner(), { fetcher });
    const sourceId = await makeSource();

    const version = await service.ingestUrl(ctx(), sourceId, 'https://example.com/about');

    expect(version.status).toBe(LeadFlowBriefingSourceVersionStatus.Available);
    expect(fetcher.fetchUrl).toHaveBeenCalledWith('https://example.com/about', expect.any(Object));
    expect(files.uploaded).toHaveLength(1);
  });

  it('rejects ingestion into a source belonging to a different tenant', async () => {
    const { service } = makeIngestionService(new FakeScanner());
    const sourceId = await makeSource();
    const otherTenantCtx = { tenantId: randomUUID(), workspaceId, userId: randomUUID() };

    await expect(
      service.ingestUpload(otherTenantCtx, sourceId, {
        buffer: PDF_BYTES,
        mimetype: 'application/pdf',
        originalname: 'brief.pdf',
        size: PDF_BYTES.length,
      }),
    ).rejects.toThrow(/not found/);
  });
});
