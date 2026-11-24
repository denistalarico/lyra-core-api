import { createResolvedOrganicCredential } from '../../credentials/resolved-organic-credential';
import { describeSocialPublisherAdapterConformance } from '../social-publisher-adapter.conformance';
import type { PublicationPayload } from '../social-publisher.adapter';
import { ThreadsApiError, type ThreadsApiClient } from './threads-api.client';
import { threadsTextLength } from './threads-capabilities';
import { ThreadsPublisherAdapter } from './threads-publisher.adapter';

const credential = createResolvedOrganicCredential({
  assetId: 'a1',
  connectionId: 'c1',
  tenantId: 't1',
  workspaceId: 'w1',
  agencyClientId: null,
  provider: 'threads',
  assetType: 'threads_account',
  externalAssetId: '1789',
  scopes: [],
  credentialVersion: 1,
  accessToken: 'secret-token',
});

const payload: PublicationPayload = {
  assetType: 'threads_account',
  placement: 'feed',
  caption: 'Novidade no ar #lyra',
  firstComment: null,
  hashtags: [],
  cta: null,
  mediaAssetId: null,
  mediaAssetIds: [],
  scheduledAt: new Date('2026-11-23T12:00:00Z'),
};

function build(overrides: Record<string, jest.Mock> = {}) {
  const api = {
    createContainer: jest.fn().mockResolvedValue('111'),
    containerStatus: jest
      .fn()
      .mockResolvedValue({ status: 'FINISHED', errorMessage: null }),
    publishContainer: jest.fn().mockResolvedValue('999'),
    permalink: jest
      .fn()
      .mockResolvedValue('https://www.threads.com/@lyra/post/abc'),
    ...overrides,
  };
  return {
    api,
    adapter: new ThreadsPublisherAdapter(api as unknown as ThreadsApiClient),
  };
}

const media = (index: number, count: number, mimeType = 'image/jpeg') => ({
  credential,
  payload: {
    ...payload,
    mediaAssetIds: Array.from({ length: count }, (_, i) => `m${i}`),
  },
  sourceUrl: `https://media.example/m${index}`,
  mimeType,
  bytes: 1024,
  mediaIndex: index,
  mediaCount: count,
});

describeSocialPublisherAdapterConformance({
  createAdapter: () => build().adapter,
  assetType: 'threads_account',
  credential,
  payload,
});

describe('threadsTextLength', () => {
  it('counts characters, and emoji by their UTF-8 bytes', () => {
    expect(threadsTextLength('olá')).toBe(3);
    expect(threadsTextLength('oi 👋')).toBe(3 + 4);
    // Emoji with variation selector: ❤ (3 bytes) + U+FE0F (3 bytes).
    expect(threadsTextLength('❤️')).toBe(6);
  });
});

describe('ThreadsPublisherAdapter', () => {
  it('validates text, length and unsupported fields', () => {
    const { adapter } = build();
    expect(adapter.validate(payload)).toEqual({ valid: true });
    expect(adapter.validate({ ...payload, caption: '   ' })).toEqual({
      valid: false,
      issues: [{ field: 'caption', reason: 'text_or_media_required' }],
    });
    expect(adapter.validate({ ...payload, caption: '😀'.repeat(126) })).toEqual(
      {
        valid: false,
        issues: [{ field: 'caption', reason: 'caption_too_long' }],
      },
    );
    expect(
      adapter.validate({
        ...payload,
        placement: 'story',
        firstComment: 'oi',
        providerOptions: { a: 1 },
      }),
    ).toMatchObject({
      valid: false,
      issues: expect.arrayContaining([
        { field: 'placement', reason: 'unsupported_placement' },
        { field: 'firstComment', reason: 'unsupported_first_comment' },
        { field: 'providerOptions', reason: 'unsupported' },
      ]),
    });
  });

  it('publishes a text post: TEXT container, then threads_publish', async () => {
    const { adapter, api } = build();
    const result = await adapter.publish({
      credential,
      payload,
      preparedMedia: [],
      idempotencyKey: 'k1',
    });
    expect(api.createContainer).toHaveBeenCalledWith({
      userId: '1789',
      accessToken: 'secret-token',
      mediaType: 'TEXT',
      text: 'Novidade no ar #lyra',
    });
    expect(api.publishContainer).toHaveBeenCalledWith({
      userId: '1789',
      accessToken: 'secret-token',
      containerId: '111',
    });
    expect(result).toMatchObject({
      outcome: 'published',
      externalPublicationId: '999',
      externalPermalink: 'https://www.threads.com/@lyra/post/abc',
    });
  });

  it('keeps the post published when the permalink lookup fails', async () => {
    const { adapter } = build({
      permalink: jest.fn().mockRejectedValue(new ThreadsApiError(500, 1)),
    });
    const result = await adapter.publish({
      credential,
      payload,
      preparedMedia: [],
      idempotencyKey: 'k1',
    });
    expect(result).toMatchObject({
      outcome: 'published',
      externalPublicationId: '999',
      externalPermalink: null,
    });
  });

  it('creates a single image container with the text', async () => {
    const { adapter, api } = build();
    const prepared = await adapter.prepareMedia(media(0, 1));
    expect(api.createContainer).toHaveBeenCalledWith({
      userId: '1789',
      accessToken: 'secret-token',
      mediaType: 'IMAGE',
      imageUrl: 'https://media.example/m0',
      text: 'Novidade no ar #lyra',
    });
    expect(prepared.providerMediaRef).toBe('th-container:111');
  });

  it('rejects an image over 8 MB before calling Threads', async () => {
    const { adapter, api } = build();
    await expect(
      adapter.prepareMedia({ ...media(0, 1), bytes: 9 * 1024 * 1024 }),
    ).rejects.toMatchObject({ code: 'threads_image_too_large' });
    expect(api.createContainer).not.toHaveBeenCalled();
  });

  it('builds a carousel: items without text, parent with children and text', async () => {
    const createContainer = jest
      .fn()
      .mockResolvedValueOnce('201')
      .mockResolvedValueOnce('202')
      .mockResolvedValueOnce('300');
    const { adapter, api } = build({ createContainer });
    const first = await adapter.prepareMedia(media(0, 2));
    const second = await adapter.prepareMedia(media(1, 2, 'video/mp4'));
    expect(createContainer).toHaveBeenNthCalledWith(2, {
      userId: '1789',
      accessToken: 'secret-token',
      mediaType: 'VIDEO',
      videoUrl: 'https://media.example/m1',
      isCarouselItem: true,
    });
    const result = await adapter.publish({
      credential,
      payload: { ...payload, mediaAssetIds: ['m0', 'm1'] },
      preparedMedia: [first, second],
      idempotencyKey: 'k1',
    });
    expect(createContainer).toHaveBeenNthCalledWith(3, {
      userId: '1789',
      accessToken: 'secret-token',
      mediaType: 'CAROUSEL',
      children: ['201', '202'],
      text: 'Novidade no ar #lyra',
    });
    expect(api.publishContainer).toHaveBeenCalledWith(
      expect.objectContaining({ containerId: '300' }),
    );
    expect(result.outcome).toBe('published');
  });

  it('waits on a processing container and publishes it on reconcile', async () => {
    const containerStatus = jest
      .fn()
      .mockResolvedValueOnce({ status: 'IN_PROGRESS', errorMessage: null })
      .mockResolvedValueOnce({ status: 'FINISHED', errorMessage: null });
    const { adapter, api } = build({ containerStatus });
    const first = await adapter.publish({
      credential,
      payload: { ...payload, mediaAssetIds: ['m0'] },
      preparedMedia: [
        { providerMediaRef: 'th-container:111', expiresAt: null },
      ],
      idempotencyKey: 'k1',
    });
    expect(first).toEqual({
      outcome: 'processing',
      externalPublicationId: 'th-container:111',
      providerMetadata: { phase: 'threads_container_processing' },
    });
    expect(api.publishContainer).not.toHaveBeenCalled();

    const second = await adapter.reconcile({
      credential,
      externalPublicationId: 'th-container:111',
    });
    expect(second).toMatchObject({
      outcome: 'published',
      externalPublicationId: '999',
    });
  });

  it('never republishes a container Threads already published', async () => {
    const { adapter, api } = build({
      containerStatus: jest
        .fn()
        .mockResolvedValue({ status: 'PUBLISHED', errorMessage: null }),
    });
    const result = await adapter.reconcile({
      credential,
      externalPublicationId: 'th-container:111',
    });
    expect(result).toMatchObject({
      outcome: 'published',
      externalPublicationId: 'th-container:111',
    });
    expect(api.publishContainer).not.toHaveBeenCalled();
  });

  it('maps container errors and Graph failures', async () => {
    const failed = build({
      containerStatus: jest.fn().mockResolvedValue({
        status: 'ERROR',
        errorMessage: 'FAILED_PROCESSING_VIDEO',
      }),
    });
    await expect(
      failed.adapter.reconcile({
        credential,
        externalPublicationId: 'th-container:111',
      }),
    ).resolves.toEqual({
      outcome: 'failed',
      reason: 'media_rejected',
      code: 'threads_failed_processing_video',
    });

    const expired = build({
      createContainer: jest
        .fn()
        .mockRejectedValue(new ThreadsApiError(400, 190)),
    });
    await expect(
      expired.adapter.publish({
        credential,
        payload,
        preparedMedia: [],
        idempotencyKey: 'k1',
      }),
    ).resolves.toEqual({
      outcome: 'failed',
      reason: 'credential_expired',
      code: 'threads_190',
    });

    await expect(
      failed.adapter.reconcile({
        credential,
        externalPublicationId: 'ig-container:1',
      }),
    ).resolves.toMatchObject({
      outcome: 'failed',
      code: 'threads_reconciliation_identity_invalid',
    });
  });
});
