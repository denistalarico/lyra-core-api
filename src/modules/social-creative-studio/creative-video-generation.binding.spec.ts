import { Logger } from '@nestjs/common';
import { bindVideoGenerationProviders } from './creative-video-generation.binding';
import { CreativeVideoGenerationConfigService } from './creative-video-generation-config';
import { HeyGenVideoGenerationProvider } from './heygen-video-generation.provider';
import { ViduVideoGenerationProvider } from './vidu-video-generation.provider';

const ENV = [
  'CREATIVE_VIDEO_GENERATION_ENABLED',
  'CREATIVE_VIDEO_GENERATIVE_PROVIDER',
  'CREATIVE_VIDEO_UGC_PROVIDER',
  'VIDU_API_KEY',
  'HEYGEN_API_KEY',
  'OPENAI_API_KEY',
  'CREATIVE_IMAGE_GENERATION_API_KEY',
  'CREATIVE_VIDEO_PRICING_CONFIRMED',
];
const CONFIRMED = 'vidu.credits.2026-10,heygen.payg.2026-10';

describe('CS4-B video provider binding', () => {
  const config = new CreativeVideoGenerationConfigService();
  let logs: string[];

  beforeEach(() => {
    logs = [];
    for (const level of ['log', 'error'] as const)
      jest
        .spyOn(Logger.prototype, level)
        .mockImplementation(
          (message: unknown) => void logs.push(String(message)),
        );
  });

  afterEach(() => {
    for (const name of ENV) delete process.env[name];
    jest.restoreAllMocks();
  });

  function enableAll() {
    process.env.CREATIVE_VIDEO_GENERATION_ENABLED = 'true';
    process.env.VIDU_API_KEY = 'vidu-secret';
    process.env.HEYGEN_API_KEY = 'heygen-secret';
    process.env.CREATIVE_VIDEO_PRICING_CONFIRMED = CONFIRMED;
  }

  it('routes generative_reel → Vidu and ugc_avatar → HeyGen', () => {
    enableAll();
    const registry = bindVideoGenerationProviders(config);
    expect(registry.forMode('generative_reel')).toBeInstanceOf(
      ViduVideoGenerationProvider,
    );
    expect(registry.forMode('ugc_avatar')).toBeInstanceOf(
      HeyGenVideoGenerationProvider,
    );
    expect(registry.forMode('generative_reel').enabled).toBe(true);
    expect(registry.canSubmit('vidu')).toBe(true);
    expect(registry.canSubmit('heygen')).toBe(true);
  });

  it('defaults to disabled: no switch, no new work (503 upstream), boot never fails', () => {
    process.env.VIDU_API_KEY = 'vidu-secret';
    process.env.HEYGEN_API_KEY = 'heygen-secret';
    process.env.CREATIVE_VIDEO_PRICING_CONFIRMED = CONFIRMED;
    const registry = bindVideoGenerationProviders(config);
    expect(registry.forMode('generative_reel').enabled).toBe(false);
    expect(registry.forMode('ugc_avatar').enabled).toBe(false);
    expect(registry.canSubmit('vidu')).toBe(false);
    // …but a paid job already submitted can still be followed to the end.
    expect(registry.byId('vidu')).toBeInstanceOf(ViduVideoGenerationProvider);
  });

  it('needs the DEDICATED key: an image/OpenAI key never enables video', () => {
    enableAll();
    delete process.env.VIDU_API_KEY;
    delete process.env.HEYGEN_API_KEY;
    process.env.OPENAI_API_KEY = 'sk-image';
    process.env.CREATIVE_IMAGE_GENERATION_API_KEY = 'sk-image-2';
    const registry = bindVideoGenerationProviders(config);
    expect(registry.forMode('generative_reel').enabled).toBe(false);
    expect(registry.forMode('ugc_avatar').enabled).toBe(false);
    expect(registry.byId('vidu')).toBeNull();
    expect(logs.join('\n')).toContain('VIDU_API_KEY is not set');
  });

  it('needs the pricing version confirmed by the operator', () => {
    enableAll();
    process.env.CREATIVE_VIDEO_PRICING_CONFIRMED = 'heygen.payg.2026-10';
    const registry = bindVideoGenerationProviders(config);
    expect(registry.forMode('generative_reel').enabled).toBe(false);
    expect(registry.forMode('ugc_avatar').enabled).toBe(true);
    expect(logs.join('\n')).toContain(
      'pricing vidu.credits.2026-10 not listed',
    );
  });

  it('per-mode switch and unsupported values stay disabled; secrets never logged', () => {
    enableAll();
    process.env.CREATIVE_VIDEO_GENERATIVE_PROVIDER = 'disabled';
    process.env.CREATIVE_VIDEO_UGC_PROVIDER = 'pletor';
    const registry = bindVideoGenerationProviders(config);
    expect(registry.forMode('generative_reel').enabled).toBe(false);
    expect(registry.forMode('ugc_avatar').enabled).toBe(false);
    const all = logs.join('\n');
    expect(all).toContain(
      'CREATIVE_VIDEO_UGC_PROVIDER has an unsupported value',
    );
    expect(all).not.toContain('vidu-secret');
    expect(all).not.toContain('heygen-secret');
  });

  it('config defaults are conservative', () => {
    expect(config.enabled).toBe(false);
    expect(config.workerConcurrency).toBe(2);
    expect(config.providerConcurrency).toBe(3);
    expect(config.ugcEngine).toBe('avatar_iii');
    expect(config.callbackBaseUrl).toBeNull();
    process.env.CREATIVE_VIDEO_CALLBACK_BASE_URL = 'http://insecure.example';
    expect(config.callbackBaseUrl).toBeNull();
    process.env.CREATIVE_VIDEO_CALLBACK_BASE_URL =
      'https://api.example.com/api/';
    expect(config.callbackBaseUrl).toBe('https://api.example.com/api');
    delete process.env.CREATIVE_VIDEO_CALLBACK_BASE_URL;
  });
});
