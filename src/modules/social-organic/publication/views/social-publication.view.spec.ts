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
});
