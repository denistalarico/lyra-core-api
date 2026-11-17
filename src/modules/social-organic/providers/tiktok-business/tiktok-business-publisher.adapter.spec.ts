import { createResolvedOrganicCredential } from '../../credentials/resolved-organic-credential';
import { describeSocialPublisherAdapterConformance } from '../social-publisher-adapter.conformance';
import type { PublicationPayload } from '../social-publisher.adapter';
import {
  TiktokBusinessApiError,
  type TiktokBusinessApiClient,
} from './tiktok-business-api.client';
import {
  TiktokBusinessPublisherAdapter,
  readTiktokBusinessOptions,
} from './tiktok-business-publisher.adapter';

const credential = createResolvedOrganicCredential({
  assetId: 'a1',
  connectionId: 'c1',
  tenantId: 't1',
  workspaceId: 'w1',
  agencyClientId: null,
  provider: 'tiktok_business',
  assetType: 'tiktok_business_account',
  externalAssetId: 'biz-1',
  scopes: [],
  credentialVersion: 1,
  accessToken: 'secret-token',
});

const payload: PublicationPayload = {
  assetType: 'tiktok_business_account',
  placement: 'video',
  caption: 'Legenda #lyra',
  firstComment: null,
  hashtags: [],
  cta: null,
  mediaAssetId: 'm1',
  mediaAssetIds: ['m1'],
  providerOptions: {
    disableComment: false,
    disableDuet: false,
    disableStitch: false,
    isBrandOrganic: true,
    isBrandedContent: false,
    isAiGenerated: false,
  },
  scheduledAt: new Date('2026-11-20T12:00:00Z'),
};

const settings = {
  privacyLevelOptions: ['PUBLIC_TO_EVERYONE'],
  commentDisabled: false,
  duetDisabled: true,
  stitchDisabled: false,
  maxVideoPostDurationSec: 600,
};

function build(overrides: Record<string, jest.Mock> = {}) {
  const api = {
    videoSettings: jest.fn().mockResolvedValue(settings),
    publishVideo: jest.fn().mockResolvedValue('v_pub_url~1'),
    publishStatus: jest.fn(),
    ...overrides,
  };
  return {
    api,
    adapter: new TiktokBusinessPublisherAdapter(
      api as unknown as TiktokBusinessApiClient,
    ),
  };
}

const media = {
  credential,
  payload,
  sourceUrl: 'https://media.lyrasuite.com/private/v.mp4?X-Amz-Signature=s',
  mimeType: 'video/mp4',
  bytes: 1000,
  mediaIndex: 0,
  mediaCount: 1,
};

describeSocialPublisherAdapterConformance({
  createAdapter: () => build().adapter,
  assetType: 'tiktok_business_account',
  credential,
  payload,
});

describe('TiktokBusinessPublisherAdapter', () => {
  it('is its own provider key, one video, 30-minute source URL, no removal', () => {
    const { adapter } = build();
    expect(adapter.provider).toBe('tiktok_business');
    expect(adapter.capabilities('tiktok_business_account').placements).toEqual([
      'video',
    ]);
    expect(adapter.sourceUrlTtlSeconds).toBe(1800);
    expect('remove' in adapter).toBe(false);
  });

  it('rejects a private privacy level, extra media and a first comment', () => {
    const { adapter } = build();
    const result = adapter.validate({
      ...payload,
      firstComment: 'oi',
      mediaAssetIds: ['m1', 'm2'],
      providerOptions: {
        ...payload.providerOptions,
        privacyLevel: 'SELF_ONLY',
      },
    });
    expect(result.valid).toBe(false);
    expect(
      result.valid ? [] : result.issues.map((issue) => issue.reason),
    ).toEqual(
      expect.arrayContaining([
        'unsupported_first_comment',
        'single_video_required',
        'public_only',
      ]),
    );
  });

  it('defaults interactions off and disclosures false; non-booleans are issues', () => {
    expect(readTiktokBusinessOptions(undefined).options).toEqual({
      disableComment: true,
      disableDuet: true,
      disableStitch: true,
      isBrandOrganic: false,
      isBrandedContent: false,
      isAiGenerated: false,
    });
    expect(
      readTiktokBusinessOptions({ isBrandOrganic: 'yes' }).issues,
    ).toHaveLength(1);
  });

  it('publishes from the presigned URL with the business id; account settings tighten interactions', async () => {
    const { api, adapter } = build();
    const prepared = await adapter.prepareMedia(media);
    expect(prepared.providerMediaRef).toBe('ttb-share:v_pub_url~1');
    expect(api.publishVideo).toHaveBeenCalledWith({
      accessToken: 'secret-token',
      businessId: 'biz-1',
      videoUrl: media.sourceUrl,
      post: {
        caption: 'Legenda #lyra',
        isBrandOrganic: true,
        isBrandedContent: false,
        isAiGenerated: false,
        disableComment: false,
        disableDuet: true,
        disableStitch: false,
      },
    });
  });

  it('maps an unverified-domain style refusal to a classified failure', async () => {
    const { adapter } = build({
      publishVideo: jest
        .fn()
        .mockRejectedValue(new TiktokBusinessApiError(200, 40002)),
    });
    await expect(adapter.prepareMedia(media)).rejects.toMatchObject({
      reason: 'payload_invalid',
      code: 'tiktok_business_40002',
    });
  });

  it('reconciles: waits for the post id, then publishes; FAILED keeps the reason', async () => {
    const status = jest
      .fn()
      .mockResolvedValueOnce({
        status: 'PROCESSING_DOWNLOAD',
        postIds: [],
        reason: null,
      })
      .mockResolvedValueOnce({
        status: 'PUBLISH_COMPLETE',
        postIds: [],
        reason: null,
      })
      .mockResolvedValueOnce({
        status: 'PUBLISH_COMPLETE',
        postIds: ['7311'],
        reason: null,
      })
      .mockResolvedValueOnce({
        status: 'FAILED',
        postIds: [],
        reason: 'frame_rate_check_failed',
      });
    const { adapter } = build({ publishStatus: status });
    const input = {
      credential,
      externalPublicationId: 'ttb-share:v_pub_url~1',
    };
    expect((await adapter.reconcile(input)).outcome).toBe('processing');
    expect((await adapter.reconcile(input)).outcome).toBe('processing');
    expect(await adapter.reconcile(input)).toMatchObject({
      outcome: 'published',
      externalPublicationId: '7311',
    });
    expect(await adapter.reconcile(input)).toMatchObject({
      outcome: 'failed',
      reason: 'media_rejected',
      code: 'tiktok_business_frame_rate_check_failed',
    });
    expect(status).toHaveBeenCalledWith({
      accessToken: 'secret-token',
      businessId: 'biz-1',
      publishId: 'v_pub_url~1',
    });
  });
});
