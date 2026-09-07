import type { SocialPublicationEntity } from '../entities/social-publication.entity';
import { toSocialPublicationView } from './social-publication.view';

describe('toSocialPublicationView', () => {
  it('never exposes providerMetadata, even if present on the row', () => {
    const publication = {
      id: 'pub-1',
      contentItemId: 'content-1',
      destinationId: 'destination-1',
      provider: 'meta',
      connectionId: 'connection-1',
      assetId: 'asset-1',
      externalAssetId: 'external-asset-1',
      status: 'published',
      scheduledAt: new Date('2026-09-06T12:00:00Z'),
      publishedAt: new Date('2026-09-06T12:05:00Z'),
      externalPublicationId: 'external-pub-1',
      externalPermalink: 'https://example.test/p/1',
      attempts: 1,
      maxAttempts: 5,
      lastErrorCode: null,
      failureReason: null,
      createdById: 'user-1',
      cancelledById: null,
      cancelledAt: null,
      createdAt: new Date('2026-09-06T11:00:00Z'),
      updatedAt: new Date('2026-09-06T12:05:00Z'),
      providerMetadata: { secret: 'raw provider payload' },
    } as unknown as SocialPublicationEntity;

    const view = toSocialPublicationView(publication);

    expect(view).not.toHaveProperty('providerMetadata');
    expect(JSON.stringify(view)).not.toContain('raw provider payload');
    expect(view.id).toBe('pub-1');
    expect(view.status).toBe('published');
  });

  it('exposes mediaAssetId as a bare reference but never storagePath or media metadata', () => {
    const publication = {
      id: 'pub-1',
      contentItemId: 'content-1',
      destinationId: 'destination-1',
      provider: 'meta',
      connectionId: 'connection-1',
      assetId: 'asset-1',
      externalAssetId: 'external-asset-1',
      mediaAssetId: 'media-asset-1',
      mediaAsset: {
        id: 'media-asset-1',
        storagePath: 'tenant-1/workspace-1/media/private-object.jpg',
        mimeType: 'image/jpeg',
      },
      status: 'scheduled',
      scheduledAt: new Date('2026-09-06T12:00:00Z'),
      publishedAt: null,
      externalPublicationId: null,
      externalPermalink: null,
      attempts: 0,
      maxAttempts: 5,
      lastErrorCode: null,
      failureReason: null,
      createdById: 'user-1',
      cancelledById: null,
      cancelledAt: null,
      createdAt: new Date('2026-09-06T11:00:00Z'),
      updatedAt: new Date('2026-09-06T11:00:00Z'),
      providerMetadata: {},
    } as unknown as SocialPublicationEntity;

    const view = toSocialPublicationView(publication);

    expect(view.mediaAssetId).toBe('media-asset-1');
    expect(view).not.toHaveProperty('mediaAsset');
    expect(JSON.stringify(view)).not.toContain('private-object.jpg');
    expect(JSON.stringify(view)).not.toContain('storagePath');
  });

  it('exposes mediaAssetId as null for a text-only publication', () => {
    const publication = {
      id: 'pub-1',
      contentItemId: 'content-1',
      destinationId: 'destination-1',
      provider: 'meta',
      connectionId: 'connection-1',
      assetId: 'asset-1',
      externalAssetId: 'external-asset-1',
      mediaAssetId: null,
      status: 'scheduled',
      scheduledAt: new Date('2026-09-06T12:00:00Z'),
      publishedAt: null,
      externalPublicationId: null,
      externalPermalink: null,
      attempts: 0,
      maxAttempts: 5,
      lastErrorCode: null,
      failureReason: null,
      createdById: 'user-1',
      cancelledById: null,
      cancelledAt: null,
      createdAt: new Date('2026-09-06T11:00:00Z'),
      updatedAt: new Date('2026-09-06T11:00:00Z'),
      providerMetadata: {},
    } as unknown as SocialPublicationEntity;

    const view = toSocialPublicationView(publication);

    expect(view.mediaAssetId).toBeNull();
  });
});
