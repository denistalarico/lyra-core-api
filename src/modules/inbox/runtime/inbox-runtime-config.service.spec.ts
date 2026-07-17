import { InboxRuntimeConfigService } from './inbox-runtime-config.service';

const managedNames = [
  'INBOX_TRANSCRIPTION_PROVIDER_MODE',
  'INBOX_DECISION_PROVIDER_MODE',
  'INBOX_PROVIDER_API_KEY',
  'INBOX_PROVIDER_BASE_URL',
  'OPENAI_API_KEY',
  'INBOX_LIVE_SESSION_ID',
  'INBOX_TRANSCRIPTION_MODEL',
  'INBOX_DECISION_MODEL',
];

describe('InboxRuntimeConfigService activation safety', () => {
  const original = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const name of managedNames) {
      original.set(name, process.env[name]);
      delete process.env[name];
    }
  });

  afterEach(() => {
    for (const name of managedNames) {
      const value = original.get(name);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it('keeps providers disabled while exposing the evaluated test model defaults', () => {
    const config = new InboxRuntimeConfigService();
    expect(config).toMatchObject({
      transcriptionMode: 'disabled',
      decisionMode: 'disabled',
      transcriptionModel: 'gpt-4o-mini-transcribe',
      decisionModel: 'gpt-5.6-terra',
      autoReplyEnabled: false,
      autoCrmEnabled: false,
    });
  });

  it('refuses live mode without both a key and an explicit activation session', () => {
    process.env.INBOX_DECISION_PROVIDER_MODE = 'live';
    process.env.INBOX_PROVIDER_API_KEY = 'test-only';
    const config = new InboxRuntimeConfigService();
    expect(() => config.onModuleInit()).toThrow(
      'inbox_live_provider_configuration_missing',
    );
  });

  it('uses the explicit provider key before the OpenAI fallback', () => {
    process.env.INBOX_PROVIDER_API_KEY = 'explicit-provider-key';
    process.env.OPENAI_API_KEY = 'openai-fallback-key';
    const config = new InboxRuntimeConfigService();
    expect(config.apiKey).toBe('explicit-provider-key');
  });

  it('uses OPENAI_API_KEY only for the exact normalized OpenAI hostname', () => {
    process.env.OPENAI_API_KEY = 'openai-fallback-key';
    process.env.INBOX_PROVIDER_BASE_URL = 'https://API.OPENAI.COM/v1/';
    expect(new InboxRuntimeConfigService().apiKey).toBe('openai-fallback-key');

    for (const endpoint of [
      'https://api.openai.com.example/v1',
      'https://api.openai.com./v1',
      'https://provider.example/v1',
    ]) {
      process.env.INBOX_PROVIDER_BASE_URL = endpoint;
      expect(new InboxRuntimeConfigService().apiKey).toBe('');
    }
  });
});
