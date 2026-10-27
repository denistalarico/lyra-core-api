import 'reflect-metadata';
import { ServiceUnavailableException, ValidationPipe } from '@nestjs/common';
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { CLIENT_AREA_EXPOSED_METADATA } from '../../common/client-area-bridge/client-area-bridge.registry';
import type { RequestContext } from '../../common/context/request-context.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PdfEngineUnavailableError } from '../document-layouts/document-pdf-renderer.service';
import {
  ANY_PERMISSION_KEYS_METADATA,
  PERMISSION_KEY_METADATA,
  PermissionsGuard,
  PRODUCT_ENTITLEMENT_METADATA,
} from '../permissions';
import { CreateLeadFlowAnalyticsReportDto } from './dto/leadflow-analytics-report.dto';
import { LeadFlowAnalyticsReportsController } from './leadflow-analytics-reports.controller';

const TENANT = '10000000-0000-4000-8000-000000000001';
const WORKSPACE = '20000000-0000-4000-8000-000000000001';
const CLIENT = '30000000-0000-4000-8000-000000000001';
const COMPANY = '31000000-0000-4000-8000-000000000001';
const REPORT = '70000000-0000-4000-8000-000000000001';

const READ_KEYS = [
  'leadflow.analytics.reports.view.operational',
  'leadflow.analytics.reports.view.full',
];

type Handler = 'list' | 'preview' | 'renderPdf' | 'file' | 'remove';

function handler(name: Handler): object {
  return Object.getOwnPropertyDescriptor(
    LeadFlowAnalyticsReportsController.prototype,
    name,
  )?.value as object;
}

function build() {
  const service = {
    list: jest.fn().mockResolvedValue([]),
    renderPdf: jest
      .fn()
      .mockResolvedValue({ buffer: Buffer.from('%PDF'), filename: 'r.pdf' }),
    getFile: jest.fn(),
    remove: jest.fn().mockResolvedValue(undefined),
  };
  const response = { set: jest.fn(), send: jest.fn() };
  return {
    controller: new LeadFlowAnalyticsReportsController(service as never),
    service,
    response,
  };
}

const companyCtx = {
  tenantId: TENANT,
  workspaceId: WORKSPACE,
  userId: 'u',
  role: 'operator',
  managedContext: {
    productKey: 'leadflow',
    operatingMode: 'client',
    clientId: CLIENT,
    companyContextId: COMPANY,
    managedTenantId: null,
  },
} as RequestContext;

const dto = {
  title: 'Relatório',
  channels: ['overview'],
  since: '2026-09-01T03:00:00.000Z',
  until: '2026-09-30',
  pageMode: 'continuous',
  snapshot: { version: 2 },
} as CreateLeadFlowAnalyticsReportDto;

describe('LeadFlowAnalyticsReportsController — route metadata', () => {
  it('replaces the legacy path under leadflow/analytics/reports', () => {
    expect(
      Reflect.getMetadata(PATH_METADATA, LeadFlowAnalyticsReportsController),
    ).toBe('leadflow/analytics/reports');
    expect(Reflect.getMetadata(PATH_METADATA, handler('renderPdf'))).toBe(
      'pdf',
    );
  });

  it('runs behind JwtAuthGuard + PermissionsGuard and the LeadFlow entitlement', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, LeadFlowAnalyticsReportsController),
    ).toEqual([JwtAuthGuard, PermissionsGuard]);
    expect(
      Reflect.getMetadata(
        PRODUCT_ENTITLEMENT_METADATA,
        LeadFlowAnalyticsReportsController,
      ),
    ).toBe('leadflow');
  });

  it.each(['list', 'preview', 'renderPdf', 'file'] as const)(
    '%s accepts either LeadFlow read key',
    (name) => {
      expect(
        Reflect.getMetadata(ANY_PERMISSION_KEYS_METADATA, handler(name)),
      ).toEqual(READ_KEYS);
      expect(
        Reflect.getMetadata(PERMISSION_KEY_METADATA, handler(name)),
      ).toBeUndefined();
    },
  );

  it('remove requires the full key only', () => {
    expect(
      Reflect.getMetadata(PERMISSION_KEY_METADATA, handler('remove')),
    ).toBe('leadflow.analytics.reports.view.full');
    expect(
      Reflect.getMetadata(ANY_PERMISSION_KEYS_METADATA, handler('remove')),
    ).toBeUndefined();
  });

  it.each(['list', 'preview', 'renderPdf', 'file'] as const)(
    '%s is exposed to the Client Area Analytics module (CA-AN1)',
    (name) => {
      expect(
        Reflect.getMetadata(CLIENT_AREA_EXPOSED_METADATA, handler(name)),
      ).toEqual(['analytics']);
    },
  );

  it('remove stays agency-only (CA-AN1, Q-AN-9)', () => {
    expect(
      Reflect.getMetadata(CLIENT_AREA_EXPOSED_METADATA, handler('remove')),
    ).toBeUndefined();
  });
});

describe('LeadFlowAnalyticsReportsController — scope and requests', () => {
  it('lists the company-aware scope', async () => {
    const { controller, service } = build();

    await expect(controller.list(companyCtx)).resolves.toEqual({
      items: [],
      total: 0,
    });
    expect(service.list).toHaveBeenCalledWith({
      tenantId: TENANT,
      workspaceId: WORKSPACE,
      agencyClientId: CLIENT,
      companyContextId: COMPANY,
    });
  });

  it('removes inside the company-aware scope', async () => {
    const { controller, service } = build();

    await controller.remove(companyCtx, REPORT);

    expect(service.remove).toHaveBeenCalledWith(
      expect.objectContaining({
        agencyClientId: CLIENT,
        companyContextId: COMPANY,
      }),
      REPORT,
    );
  });

  it('preview never persists; pdf does; dates are cut to the calendar day', async () => {
    const { controller, service, response } = build();

    await controller.preview(companyCtx, dto, response as never);
    await controller.renderPdf(companyCtx, dto, response as never);

    expect(service.renderPdf).toHaveBeenNthCalledWith(
      1,
      companyCtx,
      expect.objectContaining({
        persist: false,
        since: '2026-09-01',
        until: '2026-09-30',
        orientation: 'landscape',
        dashboardId: null,
      }),
    );
    expect(service.renderPdf).toHaveBeenNthCalledWith(
      2,
      companyCtx,
      expect.objectContaining({ persist: true }),
    );
    expect(response.set).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        'Content-Disposition': 'inline; filename="r.pdf"',
      }),
    );
    expect(response.set).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        'Content-Disposition': 'attachment; filename="r.pdf"',
      }),
    );
  });

  it('answers 503 with a sentence when the PDF engine is absent', async () => {
    const { controller, service, response } = build();
    service.renderPdf.mockRejectedValueOnce(
      new PdfEngineUnavailableError(new Error('no chromium')),
    );

    await expect(
      controller.renderPdf(companyCtx, dto, response as never),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

describe('CreateLeadFlowAnalyticsReportDto', () => {
  const pipe = new ValidationPipe({ whitelist: true, transform: true });
  const metadata = {
    type: 'body' as const,
    metatype: CreateLeadFlowAnalyticsReportDto,
  };

  it('accepts LeadFlow section ids', async () => {
    await expect(
      pipe.transform(
        { ...dto, channels: ['overview', 'lead_quality'] },
        metadata,
      ),
    ).resolves.toBeInstanceOf(CreateLeadFlowAnalyticsReportDto);
  });

  it.each([
    ['a Social channel', { channels: ['meta_ads'] }],
    ['no channel', { channels: [] }],
    ['a blank title', { title: '' }],
    ['an unknown page mode', { pageMode: 'booklet' }],
    ['the legacy body', { channels: undefined, reportType: 'overview' }],
  ])('refuses %s', async (_label, patch) => {
    await expect(
      pipe.transform({ ...dto, ...patch }, metadata),
    ).rejects.toBeDefined();
  });
});
