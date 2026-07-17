import { InboxProviderService } from './inbox-provider.service';

const config = {
  transcriptionMode: 'mock',
  decisionMode: 'mock',
  multimodalEnabled: true,
  transcriptionProcessorVersion: 'test-v1',
  maxImagesPerRun: 3,
};

describe('InboxProviderService', () => {
  afterEach(() => jest.restoreAllMocks());
  it('transcribes valid synthetic audio without touching the original asset', async () => {
    const provider = new InboxProviderService(config as never);
    const result = await provider.transcribe({
      tenantId: 't',
      workspaceId: 'w',
      assetId: 'a',
      mimeType: 'audio/ogg',
      byteSize: 4,
      checksum: 'sum',
      bytes: Buffer.from('OggS'),
      correlationId: 'c',
      idempotencyKey: 'i',
    });
    expect(result).toMatchObject({
      outcome: 'content',
      provider: 'mock',
      processorVersion: 'test-v1',
    });
  });

  it('represents inaudible audio as an empty result instead of invented text', async () => {
    const provider = new InboxProviderService(config as never);
    const result = await provider.transcribe({
      tenantId: 't',
      workspaceId: 'w',
      assetId: 'a',
      mimeType: 'audio/ogg',
      byteSize: 9,
      checksum: 'sum',
      bytes: Buffer.from('INAUDIBLE'),
      correlationId: 'c',
      idempotencyKey: 'i',
    });
    expect(result).toMatchObject({ outcome: 'empty', text: '' });
  });

  it('uses images in the same multimodal decision run in mock mode', async () => {
    const provider = new InboxProviderService(config as never);
    const result = await provider.decide({
      tenantId: 't',
      workspaceId: 'w',
      correlationId: 'c',
      idempotencyKey: 'i',
      agent: { id: null, versionId: null, snapshot: {} },
      businessMode: 'general',
      workspaceConfig: {},
      contact: { id: null },
      opportunity: null,
      ownership: { state: 'ai_active', version: 1 },
      allowedActions: [],
      systemPolicy: 'policy',
      untrustedData: 'data',
      promptVersion: 'v1',
      promptHash: 'hash',
      images: [
        { assetId: 'image', mimeType: 'image/png', bytes: Buffer.from('png') },
      ],
      repairAttempt: false,
    });
    expect(result.usage.images).toBe(1);
    expect(result.decision).toMatchObject({ schema_version: 1 });
  });

  it('runs the separate vision processor only when fallback is explicit', async () => {
    const disabled = new InboxProviderService({
      ...config,
      multimodalEnabled: false,
      visionFallbackEnabled: false,
    } as never);
    expect(disabled.supportsMultimodal()).toBe(false);
    await expect(
      disabled.analyzeImage({
        tenantId: 't',
        workspaceId: 'w',
        assetId: 'a',
        mimeType: 'image/png',
        checksum: 'sum',
        bytes: Buffer.from('png'),
        idempotencyKey: 'i',
      }),
    ).rejects.toMatchObject({ code: 'vision_fallback_disabled' });
    const enabled = new InboxProviderService({
      ...config,
      multimodalEnabled: false,
      visionFallbackEnabled: true,
      visionProcessorVersion: 'vision-test-v1',
    } as never);
    await expect(
      enabled.analyzeImage({
        tenantId: 't',
        workspaceId: 'w',
        assetId: 'a',
        mimeType: 'image/png',
        checksum: 'sum',
        bytes: Buffer.from('png'),
        idempotencyKey: 'i',
      }),
    ).resolves.toMatchObject({
      provider: 'mock',
      processorVersion: 'vision-test-v1',
    });
  });

  it('bounds retryable live-provider failures to the configured attempt count', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 503 }));
    const provider = new InboxProviderService({
      ...config,
      transcriptionMode: 'live',
      transcriptionModel: 'transcription-test',
      endpoint: 'https://provider.invalid/v1',
      apiKey: 'test-only',
      maxAttempts: 2,
      timeoutMs: 1_000,
    } as never);
    await expect(
      provider.transcribe({
        tenantId: 't',
        workspaceId: 'w',
        assetId: 'a',
        mimeType: 'audio/ogg',
        byteSize: 4,
        checksum: 'sum',
        bytes: Buffer.from('OggS'),
        correlationId: 'c',
        idempotencyKey: 'i',
      }),
    ).rejects.toMatchObject({ code: 'provider_unavailable', retryable: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
