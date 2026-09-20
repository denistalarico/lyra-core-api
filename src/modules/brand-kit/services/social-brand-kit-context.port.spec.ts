import { IsNull } from 'typeorm';
import { BrandKitAssetEntity, BrandKitEntity } from '../entities';
import { SocialBrandKitContextPort } from './social-brand-kit-context.port';

describe('SocialBrandKitContextPort', () => {
  const kit = {
    id: 'kit-a',
    tenantId: 'tenant-a',
    workspaceId: 'workspace-a',
    agencyClientId: null,
    palette: [{ role: 'primary', hex: '#123456' }],
    typography: [],
    guidelines: 'Preservar o produto real.',
  } as unknown as BrandKitEntity;
  const asset = {
    id: 'asset-a',
    brandKitId: 'kit-a',
    tenantId: 'tenant-a',
    workspaceId: 'workspace-a',
    agencyClientId: null,
    kind: 'product',
    usage: 'asset',
    mimeType: 'image/png',
    width: 600,
    height: 400,
    metadata: {
      label: 'Produto azul',
      notes: 'Foto aprovada',
      storagePath: 'brand-kit/private/metadata.png',
      credentials: { accessToken: 'do-not-project' },
      privateUrl: 'https://private.invalid/image',
    },
    storagePath: 'brand-kit/private/object.png',
    createdAt: new Date('2026-09-01T00:00:00Z'),
  } as unknown as BrandKitAssetEntity;

  it('returns normalized visual context without storage capabilities', async () => {
    const kits = { findOne: jest.fn().mockResolvedValue(kit) };
    const assets = { find: jest.fn().mockResolvedValue([asset]) };
    const port = new SocialBrandKitContextPort(
      kits as never,
      assets as never,
    );

    const result = await port.load({
      tenantId: 'tenant-a',
      workspaceId: 'workspace-a',
      agencyClientId: null,
    });

    expect(result).toMatchObject({
      brandKitId: 'kit-a',
      palette: kit.palette,
      guidelines: kit.guidelines,
      assets: [
        {
          id: 'asset-a',
          kind: 'product',
          usage: 'asset',
          label: 'Produto azul',
          mimeType: 'image/png',
          width: 600,
          height: 400,
          metadata: { label: 'Produto azul', notes: 'Foto aprovada' },
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain('storagePath');
    expect(JSON.stringify(result)).not.toContain('brand-kit/private');
    expect(JSON.stringify(result)).not.toContain('do-not-project');
    expect(JSON.stringify(result)).not.toContain('private.invalid');
    expect(result.assets[0]).not.toHaveProperty('bucket');
    expect(result.assets[0]).not.toHaveProperty('url');
  });

  it('scopes agency and client reads by tenant, workspace and nullable client id', async () => {
    const kits = { findOne: jest.fn().mockResolvedValue(kit) };
    const assets = { find: jest.fn().mockResolvedValue([]) };
    const port = new SocialBrandKitContextPort(
      kits as never,
      assets as never,
    );

    await port.load({
      tenantId: 'tenant-a',
      workspaceId: 'workspace-a',
      agencyClientId: null,
    });
    expect(kits.findOne.mock.calls[0][0].where).toMatchObject({
      tenantId: 'tenant-a',
      workspaceId: 'workspace-a',
      agencyClientId: IsNull(),
    });

    await port.load({
      tenantId: 'tenant-b',
      workspaceId: 'workspace-b',
      agencyClientId: 'client-b',
    });
    expect(kits.findOne.mock.calls[1][0].where).toEqual({
      tenantId: 'tenant-b',
      workspaceId: 'workspace-b',
      agencyClientId: 'client-b',
    });
    expect(assets.find.mock.calls[1][0].where).toMatchObject({
      tenantId: 'tenant-b',
      workspaceId: 'workspace-b',
      agencyClientId: 'client-b',
      brandKitId: 'kit-a',
    });
  });

  it('applies typed kind and usage filters and returns empty defaults without a kit', async () => {
    const kits = { findOne: jest.fn().mockResolvedValueOnce(kit).mockResolvedValueOnce(null) };
    const assets = { find: jest.fn().mockResolvedValue([]) };
    const port = new SocialBrandKitContextPort(
      kits as never,
      assets as never,
    );
    const scope = {
      tenantId: 'tenant-a',
      workspaceId: 'workspace-a',
      agencyClientId: null,
    };

    await port.load(scope, { kind: ['product', 'person'], usage: 'asset' });
    expect(assets.find.mock.calls[0][0].where.kind._type).toBe('in');
    expect(assets.find.mock.calls[0][0].where.usage).toBe('asset');

    await expect(port.load(scope, { kind: 'reference', usage: 'reference' })).resolves.toEqual({
      brandKitId: null,
      palette: [],
      typography: [],
      guidelines: null,
      assets: [],
    });
    expect(assets.find).toHaveBeenCalledTimes(1);
  });
});
