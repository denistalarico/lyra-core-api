import { createResolvedOrganicCredential } from '../../credentials/resolved-organic-credential';
import { describeSocialPublisherAdapterConformance } from '../social-publisher-adapter.conformance';
import type { PublicationPayload } from '../social-publisher.adapter';
import {
  LinkedInOrganicApiError,
  type LinkedInOrganicApiClient,
} from './linkedin-organic-api.client';
import { LinkedInPublisherAdapter } from './linkedin-publisher.adapter';

const credential = createResolvedOrganicCredential({
  assetId: 'a1',
  connectionId: 'c1',
  tenantId: 't1',
  workspaceId: 'w1',
  agencyClientId: null,
  provider: 'linkedin',
  assetType: 'linkedin_organization',
  externalAssetId: '555',
  scopes: [],
  credentialVersion: 1,
  accessToken: 'secret-token',
});

const payload: PublicationPayload = {
  assetType: 'linkedin_organization',
  placement: 'feed',
  caption: 'Novidade (beta) #lyra',
  firstComment: null,
  hashtags: [],
  cta: null,
  mediaAssetId: 'm1',
  mediaAssetIds: ['m1'],
  scheduledAt: new Date('2026-11-20T12:00:00Z'),
};

function build(overrides: Record<string, jest.Mock> = {}) {
  const api = {
    initializeImageUpload: jest.fn().mockResolvedValue({
      uploadUrl: 'https://www.linkedin.com/dms-uploads/i',
      image: 'urn:li:image:I1',
    }),
    uploadImage: jest.fn().mockResolvedValue(undefined),
    imageStatus: jest.fn().mockResolvedValue('AVAILABLE'),
    initializeVideoUpload: jest.fn().mockResolvedValue({
      video: 'urn:li:video:V1',
      uploadToken: '',
      instructions: [
        {
          uploadUrl: 'https://www.linkedin.com/u',
          firstByte: 0,
          lastByte: 99999,
        },
      ],
    }),
    uploadVideoParts: jest.fn().mockResolvedValue(['e1']),
    finalizeVideoUpload: jest.fn().mockResolvedValue(undefined),
    createPost: jest.fn().mockResolvedValue('urn:li:share:9'),
    postLifecycle: jest.fn(),
    ...overrides,
  };
  const adapter = new LinkedInPublisherAdapter(
    api as unknown as LinkedInOrganicApiClient,
  );
  adapter.sleep = () => Promise.resolve();
  return { api, adapter };
}

const media = {
  credential,
  payload,
  sourceUrl: 'https://signed/x',
  mimeType: 'image/png',
  bytes: 1000,
  mediaIndex: 0,
  mediaCount: 1,
};

describeSocialPublisherAdapterConformance({
  createAdapter: () => build().adapter,
  assetType: 'linkedin_organization',
  credential,
  payload,
});

describe('LinkedInPublisherAdapter', () => {
  it('declares feed and video, no first comment and no removal', () => {
    const { adapter } = build();
    const caps = adapter.capabilities('linkedin_organization');
    expect(caps.placements).toEqual(['feed', 'video']);
    expect(caps.supportsFirstComment).toBe(false);
    expect('remove' in adapter).toBe(false);
  });

  it('accepts a text-only feed post but not an empty one', () => {
    const { adapter } = build();
    expect(
      adapter.validate({ ...payload, mediaAssetIds: [], mediaAssetId: null }),
    ).toEqual({
      valid: true,
    });
    expect(
      adapter.validate({
        ...payload,
        caption: ' ',
        mediaAssetIds: [],
        mediaAssetId: null,
      }).valid,
    ).toBe(false);
    expect(
      adapter.validate({ ...payload, placement: 'video', mediaAssetIds: [] })
        .valid,
    ).toBe(false);
  });

  it('uploads an image owned by the page and waits until AVAILABLE', async () => {
    const status = jest
      .fn()
      .mockResolvedValueOnce('PROCESSING')
      .mockResolvedValueOnce('AVAILABLE');
    const { adapter, api } = build({ imageStatus: status });
    const prepared = await adapter.prepareMedia(media);
    expect(prepared.providerMediaRef).toBe('li-image:urn:li:image:I1');
    expect(api.initializeImageUpload).toHaveBeenCalledWith(
      'secret-token',
      'urn:li:organization:555',
    );
    expect(status).toHaveBeenCalledTimes(2);
  });

  it('uploads, finalizes and posts a video as processing', async () => {
    const { adapter, api } = build();
    const prepared = await adapter.prepareMedia({
      ...media,
      payload: { ...payload, placement: 'video' },
      mimeType: 'video/mp4',
      bytes: 100000,
    });
    expect(api.finalizeVideoUpload).toHaveBeenCalledWith('secret-token', {
      video: 'urn:li:video:V1',
      uploadToken: '',
      etags: ['e1'],
    });
    await expect(
      adapter.publish({
        credential,
        payload: { ...payload, placement: 'video' },
        preparedMedia: [prepared],
        idempotencyKey: 'k',
      }),
    ).resolves.toMatchObject({
      outcome: 'processing',
      externalPublicationId: 'urn:li:share:9',
    });
  });

  it('creates the documented post body with escaped commentary', async () => {
    const { adapter, api } = build();
    const result = await adapter.publish({
      credential,
      payload,
      preparedMedia: [
        { providerMediaRef: 'li-image:urn:li:image:I1', expiresAt: null },
      ],
      idempotencyKey: 'k',
    });
    expect(result).toMatchObject({
      outcome: 'published',
      externalPublicationId: 'urn:li:share:9',
      externalPermalink: 'https://www.linkedin.com/feed/update/urn:li:share:9/',
    });
    expect(api.createPost.mock.calls[0][1]).toEqual({
      author: 'urn:li:organization:555',
      commentary: 'Novidade \\(beta\\) #lyra',
      visibility: 'PUBLIC',
      distribution: {
        feedDistribution: 'MAIN_FEED',
        targetEntities: [],
        thirdPartyDistributionChannels: [],
      },
      content: { media: { id: 'urn:li:image:I1' } },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
    });
  });

  it('maps a budget refusal to rate_limited', async () => {
    const { adapter } = build({
      createPost: jest
        .fn()
        .mockRejectedValue(
          new LinkedInOrganicApiError(429, 'daily_budget_exhausted'),
        ),
    });
    await expect(
      adapter.publish({
        credential,
        payload,
        preparedMedia: [],
        idempotencyKey: 'k',
      }),
    ).resolves.toMatchObject({ outcome: 'failed', reason: 'rate_limited' });
  });

  it('reconciles lifecycleState', async () => {
    const lifecycle = jest
      .fn()
      .mockResolvedValueOnce('PUBLISHED')
      .mockResolvedValueOnce('PUBLISH_REQUESTED')
      .mockResolvedValueOnce('PUBLISH_FAILED');
    const { adapter } = build({ postLifecycle: lifecycle });
    const input = { credential, externalPublicationId: 'urn:li:ugcPost:1' };
    await expect(adapter.reconcile(input)).resolves.toMatchObject({
      outcome: 'published',
    });
    await expect(adapter.reconcile(input)).resolves.toMatchObject({
      outcome: 'processing',
    });
    await expect(adapter.reconcile(input)).resolves.toMatchObject({
      outcome: 'failed',
      reason: 'media_rejected',
    });
  });
});
