import { ContractAiAssistConfigService } from './contract-ai-assist-config.service';

describe('ContractAiAssistConfigService', () => {
  const originalEnv = process.env;
  beforeEach(() => {
    process.env = {};
  });
  afterEach(() => {
    process.env = originalEnv;
  });

  it('defaults to disabled with the agreed model and bounds', () => {
    const config = new ContractAiAssistConfigService();
    expect(config.mode).toBe('disabled');
    expect(config.model).toBe('gpt-6.1-sol');
    expect(config.timeoutMs).toBe(60000);
    expect(config.maxInputChars).toBe(80000);
    expect(config.dailyLimitPerWorkspace).toBe(30);
    expect(() => config.onModuleInit()).not.toThrow();
  });

  it('fails boot in live mode without a key', () => {
    process.env.CONTRACT_AI_ASSIST_PROVIDER_MODE = 'live';
    expect(() => new ContractAiAssistConfigService().onModuleInit()).toThrow(
      'contract_ai_live_configuration_missing',
    );
  });

  it('does not forward the OpenAI fallback key to other hosts', () => {
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.CONTRACT_AI_ASSIST_PROVIDER_BASE_URL = 'https://other.test/v1';
    expect(new ContractAiAssistConfigService().apiKey).toBe('');
    process.env.CONTRACT_AI_ASSIST_PROVIDER_BASE_URL =
      'https://api.openai.com/v1';
    expect(new ContractAiAssistConfigService().apiKey).toBe('test-key');
  });

  it('rejects unsafe live URLs and invalid modes', () => {
    process.env.CONTRACT_AI_ASSIST_PROVIDER_MODE = 'live';
    process.env.CONTRACT_AI_ASSIST_PROVIDER_API_KEY = 'test-key';
    process.env.CONTRACT_AI_ASSIST_PROVIDER_BASE_URL = 'http://other.test/v1';
    expect(() => new ContractAiAssistConfigService().onModuleInit()).toThrow();
    process.env.CONTRACT_AI_ASSIST_PROVIDER_MODE = 'typo';
    expect(() => new ContractAiAssistConfigService()).toThrow(
      'contract_ai_provider_mode_invalid',
    );
  });

  it('bounds numeric envs, allowing a zero daily limit', () => {
    process.env.CONTRACT_AI_ASSIST_TIMEOUT_MS = 'invalid';
    process.env.CONTRACT_AI_ASSIST_MAX_INPUT_CHARS = '9999999';
    process.env.CONTRACT_AI_ASSIST_DAILY_LIMIT_PER_WORKSPACE = '0';
    const config = new ContractAiAssistConfigService();
    expect(config.timeoutMs).toBe(60000);
    expect(config.maxInputChars).toBe(80000);
    expect(config.dailyLimitPerWorkspace).toBe(0);
  });
});
