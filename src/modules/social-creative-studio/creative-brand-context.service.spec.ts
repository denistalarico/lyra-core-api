import { BadRequestException } from '@nestjs/common';
import type { RequestContext } from '../../common/context/request-context.interface';
import type { SocialBrandKitContext } from '../brand-kit/services/social-brand-kit-context.port';
import { creativeStudioScope, type CreativeStudioScope } from './creative-studio.scope';
import { CreativeStudioBrandContextService } from './creative-brand-context.service';

const agency: CreativeStudioScope = {
  tenantId: '10000000-0000-4000-8000-000000000001',
  workspaceId: '20000000-0000-4000-8000-000000000001',
  agencyClientId: null,
  companyContextId: null,
};

const companyA: CreativeStudioScope = {
  ...agency,
  agencyClientId: '30000000-0000-4000-8000-000000000001',
  companyContextId: '31000000-0000-4000-8000-000000000001',
};

const companyB: CreativeStudioScope = {
  ...companyA,
  companyContextId: '31000000-0000-4000-8000-000000000002',
};

function brandKitContext(label: string): SocialBrandKitContext {
  return {
    brandKitId: `kit-${label}`,
    palette: [{ role: 'primary', hex: '#FF6B00' }],
    typography: [{ role: 'heading', family: 'Inter' }],
    guidelines: `Guidelines ${label}`,
    assets: [
      {
        id: `logo-${label}`,
        kind: 'logo',
        usage: 'asset',
        label: `Logo ${label}`,
        mimeType: 'image/png',
        width: 800,
        height: 400,
        metadata: { alt: `Logo ${label}` },
      },
      {
        id: `product-${label}`,
        kind: 'product',
        usage: 'asset',
        label: `Produto ${label}`,
        mimeType: 'image/png',
        width: 800,
        height: 400,
        metadata: { label: `Produto ${label}` },
      },
      {
        id: `reference-${label}`,
        kind: 'reference',
        usage: 'reference',
        label: `Referência ${label}`,
        mimeType: 'image/jpeg',
        width: 800,
        height: 400,
        metadata: { composition: 'editorial' },
      },
    ],
  };
}

describe('CreativeStudioBrandContextService', () => {
  it('projects agency Brand Kit context into assets and visual references', async () => {
    const port = { load: jest.fn().mockResolvedValue(brandKitContext('agency')) };
    const service = new CreativeStudioBrandContextService(port as never);

    await expect(service.load(agency)).resolves.toEqual({
      palette: [{ role: 'primary', hex: '#FF6B00' }],
      typography: [{ role: 'heading', family: 'Inter' }],
      guidelines: 'Guidelines agency',
      assets: expect.arrayContaining([
        expect.objectContaining({ kind: 'logo', usage: 'asset' }),
        expect.objectContaining({ kind: 'product', usage: 'asset' }),
      ]),
      references: [
        expect.objectContaining({ kind: 'reference', usage: 'reference' }),
      ],
    });
    expect(port.load).toHaveBeenCalledWith(agency);
  });

  it('preserves all nine CS2A kinds while separating their canonical usages', async () => {
    const kinds = [
      ['logo', 'asset'],
      ['product', 'asset'],
      ['person', 'asset'],
      ['environment', 'asset'],
      ['graphic_element', 'asset'],
      ['texture', 'asset'],
      ['background', 'asset'],
      ['photo', 'asset'],
      ['reference', 'reference'],
    ] as const;
    const port = {
      load: jest.fn().mockResolvedValue({
        ...brandKitContext('kinds'),
        assets: kinds.map(([kind, usage]) => ({
          id: kind,
          kind,
          usage,
          mimeType: 'image/png',
          width: null,
          height: null,
          metadata: {},
        })),
      }),
    };
    const service = new CreativeStudioBrandContextService(port as never);

    const context = await service.load(agency);

    expect(context.assets.map(({ kind }) => kind)).toEqual(
      kinds.slice(0, -1).map(([kind]) => kind),
    );
    expect(context.references.map(({ kind }) => kind)).toEqual(['reference']);
  });

  it('uses the selected company context and does not fall back client-wide', async () => {
    const port = {
      load: jest.fn((scope: CreativeStudioScope) =>
        Promise.resolve(
          brandKitContext(scope.companyContextId === companyA.companyContextId ? 'a' : 'b'),
        ),
      ),
    };
    const service = new CreativeStudioBrandContextService(port as never);

    const [a, b] = await Promise.all([
      service.load(companyA),
      service.load(companyB),
    ]);

    expect(a.assets[0].label).toBe('Logo a');
    expect(b.assets[0].label).toBe('Logo b');
    expect(port.load).toHaveBeenNthCalledWith(1, companyA);
    expect(port.load).toHaveBeenNthCalledWith(2, companyB);
  });

  it('keeps only the safe metadata projected by the Brand Kit port', async () => {
    const port = { load: jest.fn().mockResolvedValue(brandKitContext('safe')) };
    const service = new CreativeStudioBrandContextService(port as never);

    const context = await service.load(agency);
    const serialized = JSON.stringify(context);

    expect(serialized).not.toContain('storagePath');
    expect(serialized).not.toContain('bucket');
    expect(serialized).not.toContain('credential');
    expect(serialized).not.toMatch(/internalUrl|signedUrl/i);
  });

  it('rejects client mode without a company before invoking the Brand Kit port', () => {
    const port = { load: jest.fn() };
    const service = new CreativeStudioBrandContextService(port as never);
    const clientWithoutCompany = {
      tenantId: agency.tenantId,
      workspaceId: agency.workspaceId,
      managedContext: {
        productKey: 'social',
        operatingMode: 'client',
        clientId: companyA.agencyClientId,
        companyContextId: null,
        managedTenantId: '40000000-0000-4000-8000-000000000001',
      },
    } as RequestContext;

    expect(() => service.load(creativeStudioScope(clientWithoutCompany))).toThrow(
      BadRequestException,
    );
    expect(port.load).not.toHaveBeenCalled();
  });
});
