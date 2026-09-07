import { createResolvedOrganicCredential } from '../../credentials/resolved-organic-credential';
import { describeSocialPublisherAdapterConformance } from '../social-publisher-adapter.conformance';
import type { PublicationPayload } from '../social-publisher.adapter';
import { InstagramPublisherAdapter } from './instagram-publisher.adapter';
import type { MetaOrganicGraphService } from './meta-organic-graph.service';

function graphMock() {
  return {
    createInstagramContainer: jest.fn(() =>
      Promise.resolve({ id: 'container-1' }),
    ),
    getInstagramContainerStatus: jest.fn(() => Promise.resolve('FINISHED')),
    publishInstagramContainer: jest.fn(() =>
      Promise.resolve({ id: 'media-1' }),
    ),
  };
}

const CREDENTIAL = createResolvedOrganicCredential({
  assetId: 'asset-ig',
  connectionId: 'connection-1',
  tenantId: 'tenant-1',
  workspaceId: 'workspace-1',
  agencyClientId: null,
  provider: 'meta',
  assetType: 'instagram_professional',
  externalAssetId: 'ig-1',
  scopes: ['instagram_content_publish'],
  credentialVersion: 1,
  accessToken: 'page-token',
});

function payload(
  overrides: Partial<PublicationPayload> = {},
): PublicationPayload {
  return {
    assetType: 'instagram_professional',
    placement: 'feed',
    caption: 'Hello Instagram',
    firstComment: null,
    hashtags: [],
    cta: null,
    mediaAssetId: 'media-asset-1',
    scheduledAt: new Date('2026-09-07T12:00:00Z'),
    ...overrides,
  };
}

function adapterWithMock() {
  const graph = graphMock();
  return {
    graph,
    adapter: new InstagramPublisherAdapter(
      graph as unknown as MetaOrganicGraphService,
    ),
  };
}

describeSocialPublisherAdapterConformance({
  createAdapter: () => adapterWithMock().adapter,
  assetType: 'instagram_professional',
  credential: CREDENTIAL,
  payload: payload(),
});

describe('InstagramPublisherAdapter', () => {
  it.each([
    ['feed', 'image/jpeg', 'image'],
    ['reel', 'video/mp4', 'video'],
    ['story', 'video/mp4', 'video'],
  ] as const)(
    'creates the correct %s container without exposing the signed URL in PreparedMedia',
    async (placement, mimeType, mediaKind) => {
      const { adapter, graph } = adapterWithMock();
      const itemPayload = payload({
        placement,
        caption: placement === 'story' ? null : 'Caption',
      });

      const prepared = await adapter.prepareMedia({
        credential: CREDENTIAL,
        payload: itemPayload,
        sourceUrl: 'https://signed.test/media',
        mimeType,
        bytes: 100,
      });

      expect(graph.createInstagramContainer).toHaveBeenCalledWith(
        expect.objectContaining({ placement, mediaKind }),
      );
      expect(prepared.providerMediaRef).not.toContain('signed.test');
    },
  );

  it('keeps an in-progress container non-terminal for reconciliation', async () => {
    const { adapter, graph } = adapterWithMock();
    graph.getInstagramContainerStatus.mockResolvedValue('IN_PROGRESS');

    await expect(
      adapter.publish({
        credential: CREDENTIAL,
        payload: payload(),
        preparedMedia: {
          providerMediaRef: '{"kind":"instagram_container","id":"container-1"}',
          expiresAt: null,
        },
        idempotencyKey: 'idem-1',
      }),
    ).resolves.toEqual({
      outcome: 'processing',
      externalPublicationId: 'ig-container:container-1',
      providerMetadata: { phase: 'container_processing' },
    });
    expect(graph.publishInstagramContainer).not.toHaveBeenCalled();
  });

  it('publishes only after the container is FINISHED', async () => {
    const { adapter, graph } = adapterWithMock();

    await expect(
      adapter.reconcile({
        credential: CREDENTIAL,
        externalPublicationId: 'ig-container:container-1',
      }),
    ).resolves.toMatchObject({
      outcome: 'published',
      externalPublicationId: 'media-1',
    });
    expect(graph.publishInstagramContainer).toHaveBeenCalledWith({
      accountId: 'ig-1',
      pageAccessToken: 'page-token',
      containerId: 'container-1',
    });
  });

  it('treats PUBLISHED container status as confirmation after a lost media_publish response', async () => {
    const { adapter, graph } = adapterWithMock();
    graph.getInstagramContainerStatus.mockResolvedValue('PUBLISHED');

    await expect(
      adapter.reconcile({
        credential: CREDENTIAL,
        externalPublicationId: 'ig-container:container-1',
      }),
    ).resolves.toMatchObject({
      outcome: 'published',
      externalPublicationId: 'ig-container:container-1',
      providerMetadata: { identitySource: 'container_status' },
    });
    expect(graph.publishInstagramContainer).not.toHaveBeenCalled();
  });

  it.each(['ERROR', 'EXPIRED'] as const)(
    'fails a terminal %s container without calling media_publish',
    async (status) => {
      const { adapter, graph } = adapterWithMock();
      graph.getInstagramContainerStatus.mockResolvedValue(status);

      await expect(
        adapter.reconcile({
          credential: CREDENTIAL,
          externalPublicationId: 'ig-container:container-1',
        }),
      ).resolves.toMatchObject({
        outcome: 'failed',
        reason: 'media_rejected',
      });
      expect(graph.publishInstagramContainer).not.toHaveBeenCalled();
    },
  );

  it('rejects carousel before any container is created because Publication has only one mediaAssetId', () => {
    const { adapter, graph } = adapterWithMock();

    expect(adapter.validate(payload({ placement: 'carousel' }))).toEqual({
      valid: false,
      issues: [
        {
          field: 'mediaAssetId',
          reason: 'multiple_media_assets_required',
        },
      ],
    });
    expect(graph.createInstagramContainer).not.toHaveBeenCalled();
  });
});
