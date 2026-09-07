import { createResolvedOrganicCredential } from '../../credentials/resolved-organic-credential';
import { describeSocialPublisherAdapterConformance } from '../social-publisher-adapter.conformance';
import type { PublicationPayload } from '../social-publisher.adapter';
import { FacebookPublisherAdapter } from './facebook-publisher.adapter';
import { MetaOrganicGraphError } from './meta-organic-graph.error';
import type { MetaOrganicGraphService } from './meta-organic-graph.service';

function graphMock() {
  return {
    uploadFacebookPhoto: jest.fn(() => Promise.resolve({ id: 'photo-1' })),
    publishFacebookFeed: jest.fn(() => Promise.resolve({ id: 'post-1' })),
    publishFacebookPhotoStory: jest.fn(() =>
      Promise.resolve({ id: 'story-1' }),
    ),
    startFacebookVideoUpload: jest.fn(() =>
      Promise.resolve({
        videoId: 'video-1',
        uploadUrl: new URL('https://rupload.facebook.com/video-upload/v24.0/1'),
      }),
    ),
    uploadFacebookVideoByUrl: jest.fn(() => Promise.resolve()),
    finishFacebookVideoUpload: jest.fn(() =>
      Promise.resolve({ id: 'video-post-1' }),
    ),
    getFacebookVideoStatus: jest.fn(() => Promise.resolve('PUBLISHED')),
    deletePublishedObject: jest.fn(() => Promise.resolve()),
  };
}

const CREDENTIAL = createResolvedOrganicCredential({
  assetId: 'asset-1',
  connectionId: 'connection-1',
  tenantId: 'tenant-1',
  workspaceId: 'workspace-1',
  agencyClientId: null,
  provider: 'meta',
  assetType: 'facebook_page',
  externalAssetId: 'page-1',
  scopes: ['pages_manage_posts'],
  credentialVersion: 1,
  accessToken: 'page-token',
});

function payload(
  overrides: Partial<PublicationPayload> = {},
): PublicationPayload {
  return {
    assetType: 'facebook_page',
    placement: 'feed',
    caption: 'Hello Page',
    firstComment: null,
    hashtags: [],
    cta: null,
    mediaAssetId: null,
    scheduledAt: new Date('2026-09-07T12:00:00Z'),
    ...overrides,
  };
}

function adapterWithMock() {
  const graph = graphMock();
  return {
    graph,
    adapter: new FacebookPublisherAdapter(
      graph as unknown as MetaOrganicGraphService,
    ),
  };
}

describeSocialPublisherAdapterConformance({
  createAdapter: () => adapterWithMock().adapter,
  assetType: 'facebook_page',
  credential: CREDENTIAL,
  payload: payload(),
});

describe('FacebookPublisherAdapter', () => {
  it('publishes a confirmed text post to the Page feed', async () => {
    const { adapter, graph } = adapterWithMock();

    await expect(
      adapter.publish({
        credential: CREDENTIAL,
        payload: payload(),
        preparedMedia: null,
        idempotencyKey: 'idem-1',
      }),
    ).resolves.toMatchObject({
      outcome: 'published',
      externalPublicationId: 'post-1',
    });
    expect(graph.publishFacebookFeed).toHaveBeenCalledWith({
      pageId: 'page-1',
      pageAccessToken: 'page-token',
      message: 'Hello Page',
      photoId: undefined,
    });
  });

  it('uploads an unpublished image during preparation and publishes its Page post', async () => {
    const { adapter, graph } = adapterWithMock();
    const imagePayload = payload({ mediaAssetId: 'media-1' });
    const prepared = await adapter.prepareMedia({
      credential: CREDENTIAL,
      payload: imagePayload,
      sourceUrl: 'https://signed.test/image.jpg',
      mimeType: 'image/jpeg',
      bytes: 100,
    });

    const result = await adapter.publish({
      credential: CREDENTIAL,
      payload: imagePayload,
      preparedMedia: prepared,
      idempotencyKey: 'idem-2',
    });

    expect(graph.uploadFacebookPhoto).toHaveBeenCalledTimes(1);
    expect(graph.publishFacebookFeed).toHaveBeenCalledWith(
      expect.objectContaining({ photoId: 'photo-1' }),
    );
    expect(result.outcome).toBe('published');
    expect(prepared.providerMediaRef).not.toContain('signed.test');
  });

  it.each([
    ['story', 'video_stories'],
    ['reel', 'video_reels'],
  ] as const)(
    'prepares and finalizes a Page %s video through the upload session',
    async (placement, edge) => {
      const { adapter, graph } = adapterWithMock();
      const videoPayload = payload({
        placement,
        caption: placement === 'story' ? null : 'Reel caption',
        mediaAssetId: 'media-video',
      });
      const prepared = await adapter.prepareMedia({
        credential: CREDENTIAL,
        payload: videoPayload,
        sourceUrl: 'https://signed.test/video.mp4',
        mimeType: 'video/mp4',
        bytes: 1_000,
      });

      await expect(
        adapter.publish({
          credential: CREDENTIAL,
          payload: videoPayload,
          preparedMedia: prepared,
          idempotencyKey: `idem-${placement}`,
        }),
      ).resolves.toMatchObject({
        outcome: 'processing',
        externalPublicationId: 'fb-video:video-post-1',
      });
      expect(graph.startFacebookVideoUpload).toHaveBeenCalledWith(
        expect.objectContaining({ edge }),
      );
      expect(graph.uploadFacebookVideoByUrl).toHaveBeenCalledTimes(1);
      expect(graph.finishFacebookVideoUpload).toHaveBeenCalledWith(
        expect.objectContaining({ edge, videoId: 'video-1' }),
      );
    },
  );

  it('marks Page video published only after status reconciliation confirms it', async () => {
    const { adapter, graph } = adapterWithMock();

    await expect(
      adapter.reconcile({
        credential: CREDENTIAL,
        externalPublicationId: 'fb-video:video-1',
      }),
    ).resolves.toMatchObject({
      outcome: 'published',
      externalPublicationId: 'video-1',
    });
    expect(graph.getFacebookVideoStatus).toHaveBeenCalledWith({
      videoId: 'video-1',
      pageAccessToken: 'page-token',
    });
  });

  it('rejects an unsupported carousel before any Graph call', () => {
    const { adapter, graph } = adapterWithMock();

    expect(adapter.validate(payload({ placement: 'carousel' }))).toEqual({
      valid: false,
      issues: [{ field: 'placement', reason: 'unsupported_placement' }],
    });
    expect(graph.publishFacebookFeed).not.toHaveBeenCalled();
  });

  it('maps safe Graph failure codes and declares no retry after send', async () => {
    const { adapter, graph } = adapterWithMock();
    graph.publishFacebookFeed.mockRejectedValue(
      new MetaOrganicGraphError({
        kind: 'transient',
        code: 'meta_network_error',
      }),
    );

    await expect(
      adapter.publish({
        credential: CREDENTIAL,
        payload: payload(),
        preparedMedia: null,
        idempotencyKey: 'idem-lost',
      }),
    ).resolves.toEqual({
      outcome: 'failed',
      reason: 'provider_unavailable',
      code: 'meta_network_error',
    });
    expect(adapter.retrySafety).toBe('non_retryable_after_send');
  });
});
