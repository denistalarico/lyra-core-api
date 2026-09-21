import { Readable } from 'node:stream';
import type { RequestContext } from '../../../common/context/request-context.interface';
import type { BrandKitService } from '../../brand-kit/services/brand-kit.service';
import type { BrandKitAssetResponse } from '../../brand-kit/dto/brand-kit.view';
import { SocialAnalyticsReportLogoService } from './social-analytics-report-logo.service';

const ctx = {
  tenantId: '10000000-0000-4000-8000-000000000001',
  workspaceId: '20000000-0000-4000-8000-000000000001',
} as RequestContext;

function asset(overrides: Partial<BrandKitAssetResponse> = {}) {
  return {
    id: 'asset-1',
    kind: 'logo',
    usage: 'asset',
    label: null,
    variant: 'horizontal',
    theme: 'light',
    originalFilename: 'logo.png',
    mimeType: 'image/png',
    sizeBytes: 1024,
    width: 200,
    height: 60,
    metadata: {},
    createdAt: '2026-09-01T00:00:00.000Z',
    contentPath: '/brand-kit/assets/asset-1/content',
    ...overrides,
  } as BrandKitAssetResponse;
}

function build(
  assets: BrandKitAssetResponse[],
  content: { mimeType?: string; bytes?: Buffer } = {},
) {
  const getAssetContent = jest.fn().mockImplementation((_ctx, id: string) => {
    const found = assets.find((entry) => entry.id === id) ?? assets[0];

    return Promise.resolve({
      asset: { ...found, mimeType: content.mimeType ?? found.mimeType },
      file: { body: Readable.from([content.bytes ?? Buffer.from([1, 2, 3])]) },
    });
  });

  const listAssets = jest.fn().mockResolvedValue(assets);

  const brandKit = {
    listAssets,
    getAssetContent,
  } as unknown as BrandKitService;

  return {
    service: new SocialAnalyticsReportLogoService(brandKit),
    listAssets,
    getAssetContent,
  };
}

describe('SocialAnalyticsReportLogoService', () => {
  it('inlines the logo as a data URI rather than as a link', async () => {
    // The Brand Kit's content endpoint is behind JwtAuthGuard, and Playwright
    // renders with `setContent` — no cookies, no Authorization header. A URL
    // here would be fetched anonymously, 401, and the logo would be silently
    // missing from the finished PDF.
    const { service } = build([asset()], { bytes: Buffer.from('PNGDATA') });

    const result = await service.resolveClientLogo(ctx);

    expect(result).toBe(
      `data:image/png;base64,${Buffer.from('PNGDATA').toString('base64')}`,
    );
    expect(result).not.toMatch(/^https?:/);
    expect(result).not.toContain('/brand-kit/assets/');
  });

  it('prefers the light horizontal lockup for a printed letterhead', async () => {
    // Light because the page is white — a dark-theme mark can be invisible
    // there, and a logo that vanishes reads as a broken image. Horizontal
    // because the letterhead slot is a wide, short band.
    const assets = [
      asset({ id: 'dark-h', theme: 'dark', variant: 'horizontal' }),
      asset({ id: 'light-mark', theme: 'light', variant: 'mark' }),
      asset({ id: 'light-h', theme: 'light', variant: 'horizontal' }),
      asset({ id: 'light-v', theme: 'light', variant: 'vertical' }),
    ];

    const { service, getAssetContent } = build(assets);

    await service.resolveClientLogo(ctx);

    expect(getAssetContent).toHaveBeenCalledWith(ctx, 'light-h');
  });

  it('ranks an asset with no theme alongside light, not behind dark', async () => {
    // A null theme is an asset uploaded before the axis existed, not a dark one.
    const { service, getAssetContent } = build([
      asset({ id: 'dark', theme: 'dark', variant: 'horizontal' }),
      asset({ id: 'untyped', theme: null, variant: 'horizontal' }),
    ]);

    await service.resolveClientLogo(ctx);

    expect(getAssetContent).toHaveBeenCalledWith(ctx, 'untyped');
  });

  it('ignores reference uploads, which are not the mark', async () => {
    const { service, getAssetContent } = build([
      asset({ id: 'ref', usage: 'reference' }),
      asset({ id: 'real', usage: 'asset', variant: 'mark' }),
    ]);

    await service.resolveClientLogo(ctx);

    expect(getAssetContent).toHaveBeenCalledWith(ctx, 'real');
  });

  it('returns null when the kit has no logo at all', async () => {
    const { service, getAssetContent } = build([asset({ kind: 'product' })]);

    await expect(service.resolveClientLogo(ctx)).resolves.toBeNull();
    expect(getAssetContent).not.toHaveBeenCalled();
  });

  it('returns null rather than failing the whole export when the kit errors', async () => {
    // A report the operator needs must not be denied over decoration.
    const brandKit = {
      listAssets: jest.fn().mockRejectedValue(new Error('storage down')),
      getAssetContent: jest.fn(),
    } as unknown as BrandKitService;

    const service = new SocialAnalyticsReportLogoService(brandKit);

    await expect(service.resolveClientLogo(ctx)).resolves.toBeNull();
  });

  it('skips a format a browser will not render inline', async () => {
    const { service } = build([asset()], { mimeType: 'application/pdf' });

    await expect(service.resolveClientLogo(ctx)).resolves.toBeNull();
  });

  it('skips an asset larger than the inline ceiling', async () => {
    // Base64 costs ~33% on top, and the result is carried in the HTML handed
    // to Chromium; an oversized asset degrades to "no logo", never to a hang.
    const { service } = build([asset()], {
      bytes: Buffer.alloc(3 * 1024 * 1024),
    });

    await expect(service.resolveClientLogo(ctx)).resolves.toBeNull();
  });

  it('reads through the Brand Kit service with the caller context', async () => {
    // The scope filter inside that service *is* the authorization: another
    // tenant's asset simply does not match. Nothing here re-implements scope.
    const { service, listAssets, getAssetContent } = build([asset()]);

    await service.resolveClientLogo(ctx);

    expect(listAssets).toHaveBeenCalledWith(ctx);
    expect(getAssetContent).toHaveBeenCalledWith(ctx, 'asset-1');
  });
});
