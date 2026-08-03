import { LeadFlowBriefingExtractionConfigService } from './leadflow-briefing-extraction-config.service';

const ENV_KEYS = [
  'LEADFLOW_BRIEFING_EXTRACTION_PROVIDER_MODE',
  'LEADFLOW_BRIEFING_EXTRACTION_PROVIDER_BASE_URL',
  'LEADFLOW_BRIEFING_EXTRACTION_PROVIDER_API_KEY',
  'LEADFLOW_BRIEFING_EXTRACTION_MODEL',
  'OPENAI_API_KEY',
];

describe('LeadFlowBriefingExtractionConfigService', () => {
  const original: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) original[key] = process.env[key];
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  });

  it('defaults to disabled mode and boots without a key', () => {
    delete process.env.LEADFLOW_BRIEFING_EXTRACTION_PROVIDER_MODE;
    delete process.env.LEADFLOW_BRIEFING_EXTRACTION_PROVIDER_API_KEY;
    delete process.env.OPENAI_API_KEY;

    const service = new LeadFlowBriefingExtractionConfigService();
    expect(service.mode).toBe('disabled');
    expect(() => service.onModuleInit()).not.toThrow();
  });

  it('refuses to boot in live mode without an API key', () => {
    process.env.LEADFLOW_BRIEFING_EXTRACTION_PROVIDER_MODE = 'live';
    delete process.env.LEADFLOW_BRIEFING_EXTRACTION_PROVIDER_API_KEY;
    delete process.env.OPENAI_API_KEY;

    const service = new LeadFlowBriefingExtractionConfigService();
    expect(() => service.onModuleInit()).toThrow(
      'leadflow_briefing_extraction_live_configuration_missing',
    );
  });

  it('refuses a non-HTTPS live endpoint that is not localhost', () => {
    process.env.LEADFLOW_BRIEFING_EXTRACTION_PROVIDER_MODE = 'live';
    process.env.LEADFLOW_BRIEFING_EXTRACTION_PROVIDER_API_KEY = 'key';
    process.env.LEADFLOW_BRIEFING_EXTRACTION_PROVIDER_BASE_URL = 'http://example.com/v1';

    const service = new LeadFlowBriefingExtractionConfigService();
    expect(() => service.onModuleInit()).toThrow(
      'leadflow_briefing_extraction_endpoint_must_use_https',
    );
  });

  it('boots live mode fine with a key and HTTPS endpoint', () => {
    process.env.LEADFLOW_BRIEFING_EXTRACTION_PROVIDER_MODE = 'live';
    process.env.LEADFLOW_BRIEFING_EXTRACTION_PROVIDER_API_KEY = 'key';

    const service = new LeadFlowBriefingExtractionConfigService();
    expect(() => service.onModuleInit()).not.toThrow();
  });

  it('only falls back to OPENAI_API_KEY when the endpoint host is api.openai.com', () => {
    delete process.env.LEADFLOW_BRIEFING_EXTRACTION_PROVIDER_API_KEY;
    process.env.OPENAI_API_KEY = 'fallback-key';
    process.env.LEADFLOW_BRIEFING_EXTRACTION_PROVIDER_BASE_URL = 'https://other-host.example/v1';

    const service = new LeadFlowBriefingExtractionConfigService();
    expect(service.apiKey).toBe('');
  });

  it('rejects an invalid provider mode', () => {
    process.env.LEADFLOW_BRIEFING_EXTRACTION_PROVIDER_MODE = 'bogus';
    expect(() => new LeadFlowBriefingExtractionConfigService()).toThrow(
      'leadflow_briefing_extraction_provider_mode_invalid',
    );
  });
});
