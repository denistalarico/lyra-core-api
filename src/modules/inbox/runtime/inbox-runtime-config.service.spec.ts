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
  'INBOX_INGESTION_WORKER_ENABLED',
  'INBOX_MEDIA_WORKER_ENABLED',
  'INBOX_DECISION_WORKER_ENABLED',
  'INBOX_OUTBOX_RELAY_ENABLED',
  'INBOX_REALTIME_GATEWAY_ENABLED',
  'INBOX_AUTO_REPLY_ENABLED',
  'INBOX_AUTO_CRM_ENABLED',
  'INBOX_AUTO_HANDOFF_ENABLED',
  'INBOX_FOLLOW_UP_ENABLED',
  'INBOX_DECISION_TRIGGER_MODE',
  'INBOX_DECISION_CONCURRENCY',
  'INBOX_PILOT_MODE',
  'INBOX_PROVIDER_BUDGET_USD',
  'INBOX_MAX_DECISION_CALLS',
  'INBOX_MAX_TRANSCRIPTION_CALLS',
  'INBOX_MAX_VISION_CALLS',
  'INBOX_MAX_IMAGE_INPUTS',
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
      autoHandoffEnabled: false,
      followUpEnabled: false,
      ingestionWorkerEnabled: false,
      mediaWorkerEnabled: false,
      decisionWorkerEnabled: false,
      outboxRelayEnabled: false,
      realtimeGatewayEnabled: false,
      decisionTriggerMode: 'manual',
      decisionWorkerConcurrency: 1,
      pilotMode: false,
      budgetUsd: 10,
      maxDecisionCalls: 200,
      maxTranscriptionCalls: 50,
      maxVisionCalls: 50,
      maxImageInputs: 50,
    });
  });

  it('requires pilot mode for automatic reply, CRM and handoff', () => {
    for (const name of [
      'INBOX_AUTO_REPLY_ENABLED',
      'INBOX_AUTO_CRM_ENABLED',
      'INBOX_AUTO_HANDOFF_ENABLED',
    ]) {
      process.env[name] = 'true';
      expect(() => new InboxRuntimeConfigService().onModuleInit()).toThrow(
        'inbox_automatic_effects_require_pilot_mode',
      );
      delete process.env[name];
    }
  });

  it('keeps follow-up fail-closed until Temporal exists', () => {
    process.env.INBOX_FOLLOW_UP_ENABLED = 'true';
    expect(() => new InboxRuntimeConfigService().onModuleInit()).toThrow(
      'inbox_follow_up_requires_temporal',
    );
  });

  it('rejects decision concurrency above the pilot ceiling', () => {
    process.env.INBOX_DECISION_CONCURRENCY = '2';
    expect(() => new InboxRuntimeConfigService()).toThrow(
      'inbox_decision_concurrency_invalid',
    );
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
