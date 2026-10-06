import { Logger } from '@nestjs/common';
import {
  CreativeGenerationConfigService,
  DEFAULT_OPENAI_IMAGE_MODEL,
} from './creative-generation-config';
import { bindImageGenerationProvider } from './creative-image-generation.binding';
import { DisabledImageGenerationProvider } from './creative-image-generation.provider';
import { OpenAIImageGenerationProvider } from './openai-image-generation.provider';

const KEY = 'sk-proj-BINDING-KEY-MUST-NOT-LEAK';
const ENVS = [
  'CREATIVE_IMAGE_GENERATION_PROVIDER',
  'CREATIVE_IMAGE_GENERATION_API_KEY',
  'CREATIVE_IMAGE_GENERATION_MODEL',
  'CREATIVE_IMAGE_GENERATION_TIMEOUT_MS',
  'OPENAI_API_KEY',
];

describe('bindImageGenerationProvider (CS3.3 kill switch)', () => {
  const saved = Object.fromEntries(
    ENVS.map((name) => [name, process.env[name]]),
  );
  let logs: string[];

  beforeEach(() => {
    for (const name of ENVS) delete process.env[name];
    logs = [];
    for (const level of ['log', 'error'] as const)
      jest
        .spyOn(Logger.prototype, level)
        .mockImplementation((message: unknown) => {
          logs.push(String(message));
        });
  });
  afterEach(() => {
    jest.restoreAllMocks();
    for (const name of ENVS)
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
  });

  const bind = () =>
    bindImageGenerationProvider(new CreativeGenerationConfigService());

  it('is disabled by default — even with OPENAI_API_KEY present', () => {
    process.env.OPENAI_API_KEY = KEY;
    const provider = bind();
    expect(provider).toBeInstanceOf(DisabledImageGenerationProvider);
    expect(provider.enabled).toBe(false);
  });

  it('binds OpenAI only when explicitly selected and a key exists', () => {
    process.env.CREATIVE_IMAGE_GENERATION_PROVIDER = 'openai';
    process.env.OPENAI_API_KEY = KEY;
    const provider = bind();
    expect(provider).toBeInstanceOf(OpenAIImageGenerationProvider);
    expect(provider.enabled).toBe(true);
    expect(provider.id).toBe('openai');
  });

  it.each([
    ['openai without any key', 'openai'],
    ['an unknown provider', 'midjourney'],
  ])('stays disabled (no boot failure) with %s', (_label, value) => {
    process.env.CREATIVE_IMAGE_GENERATION_PROVIDER = value;
    if (value !== 'openai') process.env.OPENAI_API_KEY = KEY;
    expect(bind()).toBeInstanceOf(DisabledImageGenerationProvider);
    expect(logs.join('\n')).toContain('stays disabled');
    expect(logs.join('\n')).not.toContain(KEY);
  });

  it('prefers the dedicated key over the shared one and never logs either', () => {
    process.env.CREATIVE_IMAGE_GENERATION_PROVIDER = 'OpenAI';
    process.env.OPENAI_API_KEY = 'shared';
    process.env.CREATIVE_IMAGE_GENERATION_API_KEY = KEY;
    const config = new CreativeGenerationConfigService();
    expect(config.openAiApiKey).toBe(KEY);
    expect(bindImageGenerationProvider(config)).toBeInstanceOf(
      OpenAIImageGenerationProvider,
    );
    expect(logs.join('\n')).not.toContain(KEY);
    expect(logs.join('\n')).not.toContain('shared');
  });

  it('defaults to a pinned model snapshot and bounds the timeout well below the 10-min lease', () => {
    const config = new CreativeGenerationConfigService();
    expect(config.imageModel).toBe(DEFAULT_OPENAI_IMAGE_MODEL);
    expect(DEFAULT_OPENAI_IMAGE_MODEL).toMatch(/-\d{4}-\d{2}-\d{2}$/);
    expect(config.imageTimeoutMs).toBe(180_000);

    process.env.CREATIVE_IMAGE_GENERATION_MODEL = ' gpt-image-2.5-sunburst ';
    process.env.CREATIVE_IMAGE_GENERATION_TIMEOUT_MS = '3600000';
    expect(config.imageModel).toBe('gpt-image-2.5-sunburst');
    expect(config.imageTimeoutMs).toBe(300_000);

    process.env.CREATIVE_IMAGE_GENERATION_TIMEOUT_MS = '1';
    expect(config.imageTimeoutMs).toBe(30_000);
  });
});
