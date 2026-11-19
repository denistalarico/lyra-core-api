import { createResolvedOrganicCredential } from '../../credentials/resolved-organic-credential';
import { describeSocialPublisherAdapterConformance } from '../social-publisher-adapter.conformance';
import type { PublicationPayload } from '../social-publisher.adapter';
import { SocialPublisherOperationError } from '../social-publisher.adapter';
import {
  YoutubeApiError,
  type YoutubeApiClient,
  YoutubeUploadFault,
} from './youtube-api.client';
import { YoutubePublisherAdapter } from './youtube-publisher.adapter';
import { YoutubeUploadQuota } from './youtube-upload-quota';

const credential = createResolvedOrganicCredential({
  assetId: 'a1',
  connectionId: 'c1',
  tenantId: 't1',
  workspaceId: 'w1',
  agencyClientId: null,
  provider: 'youtube',
  assetType: 'youtube_channel',
  externalAssetId: 'UCaaa',
  scopes: [],
  credentialVersion: 1,
  accessToken: 'secret-token',
});

const payload: PublicationPayload = {
  assetType: 'youtube_channel',
  placement: 'video',
  caption: 'Meu título\n\nDescrição #lyra #Social',
  firstComment: null,
  hashtags: [],
  cta: null,
  mediaAssetId: 'm1',
  mediaAssetIds: ['m1'],
  scheduledAt: new Date('2026-11-20T12:00:00Z'),
};

function build(
  overrides: Partial<Record<keyof YoutubeApiClient, jest.Mock>> = {},
  quota = new YoutubeUploadQuota(),
) {
  const api = {
    startUpload: jest
      .fn()
      .mockResolvedValue('https://www.googleapis.com/upload/x'),
    uploadFromSource: jest.fn().mockResolvedValue('vid1'),
    getVideoState: jest.fn(),
    ...overrides,
  };
  return { api, adapter: new YoutubePublisherAdapter(api as never, quota) };
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
  assetType: 'youtube_channel',
  credential,
  payload,
});

describe('YoutubePublisherAdapter', () => {
  it('declares video and short, hashtags, reconcile and no removal', () => {
    const caps = build().adapter.capabilities('youtube_channel');
    expect(caps.placements).toEqual(['video', 'short']);
    expect(caps.media.short.maxDurationSeconds).toBe(180);
    expect(caps.supportsHashtags).toBe(true);
    expect(caps.supportsRemoval).toBe(false);
    expect('remove' in build().adapter).toBe(false);
  });

  it('validates title, single video, placement and description size', () => {
    const { adapter } = build();
    expect(adapter.validate(payload)).toEqual({ valid: true });
    const bad = adapter.validate({
      ...payload,
      placement: 'feed',
      caption: '   ',
      mediaAssetIds: [],
      firstComment: 'x',
    });
    expect(bad.valid).toBe(false);
    const reasons = bad.valid ? [] : bad.issues.map((i) => i.reason);
    expect(reasons).toEqual(
      expect.arrayContaining([
        'unsupported_placement',
        'unsupported_first_comment',
        'single_video_required',
        'title_required',
      ]),
    );
    const long = adapter.validate({ ...payload, caption: 'a'.repeat(5001) });
    expect(long.valid ? [] : long.issues.map((i) => i.reason)).toContain(
      'description_too_long',
    );
  });

  it('uploads at prepareMedia with public privacy, title from line 1 and hashtag tags', async () => {
    const { api, adapter } = build();
    const prepared = await adapter.prepareMedia(media);
    expect(prepared.providerMediaRef).toBe('yt-video:vid1');
    expect(api.startUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: 'secret-token',
        totalBytes: 1000,
        metadata: {
          snippet: expect.objectContaining({
            title: 'Meu título',
            description: payload.caption,
            tags: ['lyra', 'Social'],
          }),
          status: { privacyStatus: 'public', selfDeclaredMadeForKids: false },
        },
      }),
    );
  });

  it('uses the Planner destination options: title, privacy, audience and category', async () => {
    const { api, adapter } = build();
    await adapter.prepareMedia({
      ...media,
      payload: {
        ...payload,
        providerOptions: {
          title: 'Título <próprio>',
          privacyStatus: 'unlisted',
          madeForKids: true,
          categoryId: '27',
        },
      },
    });
    const metadata = api.startUpload.mock.calls[0][0].metadata;
    expect(metadata.snippet).toMatchObject({
      title: 'Título próprio',
      categoryId: '27',
    });
    expect(metadata.status).toEqual({
      privacyStatus: 'unlisted',
      selfDeclaredMadeForKids: true,
    });
  });

  it('accepts a Short with a title and no caption', () => {
    const { adapter } = build();
    expect(
      adapter.validate({
        ...payload,
        placement: 'short',
        caption: null,
        providerOptions: { title: 'Só o título' },
      }),
    ).toEqual({ valid: true });
  });

  it('truncates the title to 100 characters', async () => {
    const { api, adapter } = build();
    await adapter.prepareMedia({
      ...media,
      payload: { ...payload, caption: 'é'.repeat(150) },
    });
    const title = api.startUpload.mock.calls[0][0].metadata.snippet.title;
    expect([...title]).toHaveLength(100);
  });

  it('refuses gracefully when the daily upload budget is spent', async () => {
    const { api, adapter } = build({}, new YoutubeUploadQuota(1));
    await adapter.prepareMedia(media);
    await expect(adapter.prepareMedia(media)).rejects.toMatchObject({
      reason: 'rate_limited',
      code: 'quota_budget_exhausted',
    });
    expect(api.startUpload).toHaveBeenCalledTimes(1);
  });

  it.each([
    [new YoutubeApiError(403, 'quotaExceeded'), 'rate_limited'],
    [new YoutubeApiError(400, 'uploadLimitExceeded'), 'rate_limited'],
    [new YoutubeApiError(401, null), 'credential_expired'],
    [new YoutubeApiError(403, 'forbidden'), 'permission_lost'],
    [new YoutubeApiError(400, 'invalidTitle'), 'payload_invalid'],
    [new YoutubeApiError(503, null), 'provider_unavailable'],
    [new YoutubeUploadFault('media_source_size_mismatch'), 'media_rejected'],
  ])('maps %p to %s', async (error, reason) => {
    const { adapter } = build({
      startUpload: jest.fn().mockRejectedValue(error),
    });
    const failure = await adapter.prepareMedia(media).catch((e) => e);
    expect(failure).toBeInstanceOf(SocialPublisherOperationError);
    expect(failure.reason).toBe(reason);
    expect(String(failure.message)).not.toContain('secret-token');
  });

  it('publish reports processing with the video id', async () => {
    const { adapter } = build();
    const result = await adapter.publish({
      credential,
      payload,
      preparedMedia: [{ providerMediaRef: 'yt-video:vid1', expiresAt: null }],
      idempotencyKey: 'k',
    });
    expect(result).toMatchObject({
      outcome: 'processing',
      externalPublicationId: 'yt-video:vid1',
    });
  });

  it.each([
    ['processed', null, 'published'],
    ['uploaded', null, 'processing'],
    ['failed', null, 'failed'],
    ['rejected', 'duplicate', 'failed'],
  ])('reconcile %s → %s', async (uploadStatus, rejectionReason, outcome) => {
    const { adapter } = build({
      getVideoState: jest.fn().mockResolvedValue({
        uploadStatus,
        failureReason: null,
        rejectionReason,
        processingStatus: null,
      }),
    });
    const result = await adapter.reconcile({
      credential,
      externalPublicationId: 'yt-video:vid1',
    });
    expect(result.outcome).toBe(outcome);
    if (rejectionReason === 'duplicate' && result.outcome === 'failed') {
      expect(result.reason).toBe('duplicate_content');
    }
  });

  it('reconcile rejects a foreign identity', async () => {
    const result = await build().adapter.reconcile({
      credential,
      externalPublicationId: 'other',
    });
    expect(result.outcome).toBe('failed');
  });
  describe('video cover', () => {
    const cover = {
      image: {
        sourceUrl: 'https://signed/cover.jpg',
        mimeType: 'image/jpeg',
        bytes: 3,
      },
      timestampMs: null,
    };
    const fetchMock = jest.spyOn(global, 'fetch');
    afterEach(() => fetchMock.mockReset());
    afterAll(() => fetchMock.mockRestore());

    it('sets the uploaded cover as the video thumbnail', async () => {
      fetchMock.mockResolvedValue(new Response(new Uint8Array([1, 2, 3])));
      const setThumbnail = jest.fn().mockResolvedValue(undefined);
      const { adapter } = build({ setThumbnail });
      await adapter.prepareMedia({ ...media, payload: { ...payload, cover } });
      expect(setThumbnail).toHaveBeenCalledWith({
        accessToken: 'secret-token',
        videoId: 'vid1',
        data: new Uint8Array([1, 2, 3]),
        mimeType: 'image/jpeg',
      });
    });

    it('keeps the uploaded video when YouTube refuses the cover', async () => {
      fetchMock.mockResolvedValue(new Response(new Uint8Array([1, 2, 3])));
      const { adapter } = build({
        setThumbnail: jest
          .fn()
          .mockRejectedValue(new YoutubeApiError(403, 'forbidden')),
      });
      await expect(
        adapter.prepareMedia({ ...media, payload: { ...payload, cover } }),
      ).resolves.toMatchObject({ providerMediaRef: 'yt-video:vid1' });
    });
  });
});
