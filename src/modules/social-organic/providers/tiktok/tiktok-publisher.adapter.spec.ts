import { createResolvedOrganicCredential } from '../../credentials/resolved-organic-credential';
import { describeSocialPublisherAdapterConformance } from '../social-publisher-adapter.conformance';
import type { PublicationPayload } from '../social-publisher.adapter';
import { SocialPublisherOperationError } from '../social-publisher.adapter';
import { TiktokApiError, type TiktokApiClient } from './tiktok-api.client';
import { TiktokPublisherAdapter } from './tiktok-publisher.adapter';

const credential = createResolvedOrganicCredential({
  assetId: 'a1',
  connectionId: 'c1',
  tenantId: 't1',
  workspaceId: 'w1',
  agencyClientId: null,
  provider: 'tiktok',
  assetType: 'tiktok_account',
  externalAssetId: 'open-1',
  scopes: [],
  credentialVersion: 1,
  accessToken: 'secret-token',
});

const payload: PublicationPayload = {
  assetType: 'tiktok_account',
  placement: 'video',
  caption: 'Legenda #lyra',
  firstComment: null,
  hashtags: [],
  cta: null,
  mediaAssetId: 'm1',
  mediaAssetIds: ['m1'],
  scheduledAt: new Date('2026-11-20T12:00:00Z'),
};

const creator = {
  username: 'u',
  nickname: 'n',
  avatarUrl: null,
  privacyLevelOptions: ['PUBLIC_TO_EVERYONE', 'SELF_ONLY'],
  commentDisabled: false,
  duetDisabled: true,
  stitchDisabled: false,
  maxVideoPostDurationSec: 600,
};

function build(overrides: Record<string, jest.Mock> = {}) {
  const api = {
    creatorInfo: jest.fn().mockResolvedValue(creator),
    initDirectPost: jest.fn().mockResolvedValue({
      publishId: 'pub1',
      uploadUrl: 'https://open-upload.tiktokapis.com/video/?x=1',
    }),
    uploadFromSource: jest.fn().mockResolvedValue(undefined),
    publishStatus: jest.fn(),
    ...overrides,
  };
  return {
    api,
    adapter: new TiktokPublisherAdapter(api as unknown as TiktokApiClient),
  };
}

const media = {
  credential,
  payload,
  sourceUrl: 'https://signed/x',
  mimeType: 'video/mp4',
  bytes: 1000,
  mediaIndex: 0,
  mediaCount: 1,
};

describeSocialPublisherAdapterConformance({
  createAdapter: () => build().adapter,
  assetType: 'tiktok_account',
  credential,
  payload,
});

describe('TiktokPublisherAdapter', () => {
  it('declares one video placement, hashtags, reconcile and no removal', () => {
    const { adapter } = build();
    const caps = adapter.capabilities('tiktok_account');
    expect(caps.placements).toEqual(['video']);
    expect(caps.supportsFirstComment).toBe(false);
    expect(caps.supportsRemoval).toBe(false);
    expect('remove' in adapter).toBe(false);
  });

  it('validates placement, single video and caption size', () => {
    const { adapter } = build();
    expect(adapter.validate(payload)).toEqual({ valid: true });
    const bad = adapter.validate({
      ...payload,
      placement: 'feed',
      mediaAssetIds: [],
      caption: 'x'.repeat(2201),
    });
    expect(bad.valid).toBe(false);
  });

  it('refuses a public privacy level while the client is unaudited', () => {
    const { adapter } = build();
    const result = adapter.validate({
      ...payload,
      providerOptions: { privacyLevel: 'PUBLIC_TO_EVERYONE' },
    });
    expect(result).toEqual({
      valid: false,
      issues: [
        {
          field: 'providerOptions.privacyLevel',
          reason: 'unaudited_client_private_only',
        },
      ],
    });
  });

  it('queries creator_info before init and posts SELF_ONLY by default', async () => {
    const { adapter, api } = build();
    const prepared = await adapter.prepareMedia(media);
    expect(prepared.providerMediaRef).toBe('tt-publish:pub1');
    const order = [
      api.creatorInfo.mock.invocationCallOrder[0],
      api.initDirectPost.mock.invocationCallOrder[0],
      api.uploadFromSource.mock.invocationCallOrder[0],
    ];
    expect(order).toEqual([...order].sort((a, b) => a - b));
    const init = api.initDirectPost.mock.calls[0][0];
    expect(init.post).toEqual({
      title: 'Legenda #lyra',
      privacyLevel: 'SELF_ONLY',
      disableComment: true,
      disableDuet: true,
      disableStitch: true,
    });
    expect(init.videoSize).toBe(1000);
  });

  it('fails when the offered privacy options do not include the choice', async () => {
    const { adapter } = build({
      creatorInfo: jest.fn().mockResolvedValue({
        ...creator,
        privacyLevelOptions: ['PUBLIC_TO_EVERYONE'],
      }),
    });
    await expect(adapter.prepareMedia(media)).rejects.toMatchObject({
      reason: 'payload_invalid',
      code: 'tiktok_privacy_level_option_mismatch',
    });
  });

  it('maps API errors to the closed failure vocabulary', async () => {
    const { adapter } = build({
      initDirectPost: jest
        .fn()
        .mockRejectedValue(new TiktokApiError(403, 'spam_risk_too_many_posts')),
    });
    const error = await adapter.prepareMedia(media).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SocialPublisherOperationError);
    expect(error).toMatchObject({ reason: 'rate_limited' });
  });

  it('publish reports processing with the prepared publish id', async () => {
    const { adapter } = build();
    await expect(
      adapter.publish({
        credential,
        payload,
        idempotencyKey: 'k',
        preparedMedia: [
          { providerMediaRef: 'tt-publish:pub1', expiresAt: null },
        ],
      }),
    ).resolves.toMatchObject({
      outcome: 'processing',
      externalPublicationId: 'tt-publish:pub1',
    });
  });

  it('reconcile: complete, in progress and documented failures', async () => {
    const status = jest.fn();
    const { adapter } = build({ publishStatus: status });
    const input = { credential, externalPublicationId: 'tt-publish:pub1' };

    status.mockResolvedValueOnce({
      status: 'PUBLISH_COMPLETE',
      failReason: null,
      publicPostIds: ['777'],
    });
    await expect(adapter.reconcile(input)).resolves.toMatchObject({
      outcome: 'published',
      externalPublicationId: '777',
    });

    status.mockResolvedValueOnce({
      status: 'PUBLISH_COMPLETE',
      failReason: null,
      publicPostIds: [],
    });
    await expect(adapter.reconcile(input)).resolves.toMatchObject({
      outcome: 'published',
      externalPublicationId: 'pub1',
    });

    status.mockResolvedValueOnce({
      status: 'PROCESSING_UPLOAD',
      failReason: null,
      publicPostIds: [],
    });
    await expect(adapter.reconcile(input)).resolves.toMatchObject({
      outcome: 'processing',
    });

    status.mockResolvedValueOnce({
      status: 'FAILED',
      failReason: 'duration_check_failed',
      publicPostIds: [],
    });
    await expect(adapter.reconcile(input)).resolves.toEqual({
      outcome: 'failed',
      reason: 'media_rejected',
      code: 'tiktok_duration_check_failed',
    });
  });
});
