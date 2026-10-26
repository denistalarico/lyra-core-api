import { OrionConfigService } from './orion-config.service';

describe('OrionConfigService', () => {
  const saved = { ...process.env };
  afterEach(() => {
    for (const key of Object.keys(process.env))
      if (key.startsWith('ORION_') || key === 'OPENAI_API_KEY')
        delete process.env[key];
    Object.assign(process.env, saved);
  });

  it('defaults to disabled with the D-OR-1 limits', () => {
    delete process.env.ORION_PROVIDER_MODE;
    const config = new OrionConfigService();
    expect(config.mode).toBe('disabled');
    expect(config.available).toBe(false);
    expect(config.model).toBe('gpt-5.6-terra');
    expect(config.tenantMonthlyBudgetUsd).toBe(5);
    expect(config.userHourlyLimit).toBe(30);
    expect(config.teamChatEnabled).toBe(false);
    expect(config.prices()).toEqual({ input: 2.5, cached: 0.25, output: 15 });
  });

  it('enables Team Chat mentions only with the explicit flag', () => {
    process.env.ORION_TEAM_CHAT_ENABLED = 'true';
    expect(new OrionConfigService().teamChatEnabled).toBe(true);

    process.env.ORION_TEAM_CHAT_ENABLED = 'false';
    expect(new OrionConfigService().teamChatEnabled).toBe(false);
  });

  it('refuses an unknown mode and a live mode without key or HTTPS', () => {
    process.env.ORION_PROVIDER_MODE = 'on';
    expect(() => new OrionConfigService()).toThrow(
      'orion_provider_mode_invalid',
    );

    process.env.ORION_PROVIDER_MODE = 'live';
    delete process.env.ORION_PROVIDER_API_KEY;
    delete process.env.OPENAI_API_KEY;
    expect(() => new OrionConfigService().onModuleInit()).toThrow(
      'orion_live_configuration_missing',
    );

    process.env.ORION_PROVIDER_API_KEY = 'key';
    process.env.ORION_PROVIDER_BASE_URL = 'http://provider.example';
    expect(() => new OrionConfigService().onModuleInit()).toThrow(
      'orion_endpoint_must_use_https',
    );
  });

  it('never sends the platform OpenAI key to another host', () => {
    process.env.OPENAI_API_KEY = 'platform-key';
    process.env.ORION_PROVIDER_BASE_URL = 'https://other.example/v1';
    expect(new OrionConfigService().apiKey).toBe('');
    process.env.ORION_PROVIDER_BASE_URL = 'https://api.openai.com/v1';
    expect(new OrionConfigService().apiKey).toBe('platform-key');
  });

  it('prices from env first, then the known model, else unpriced', () => {
    process.env.ORION_INPUT_USD_PER_MILLION = '3';
    process.env.ORION_OUTPUT_USD_PER_MILLION = '12';
    expect(new OrionConfigService().prices()).toEqual({
      input: 3,
      cached: 0.25,
      output: 12,
    });
    delete process.env.ORION_INPUT_USD_PER_MILLION;
    delete process.env.ORION_OUTPUT_USD_PER_MILLION;
    process.env.ORION_MODEL = 'unknown-model';
    const config = new OrionConfigService();
    expect(config.prices()).toBeNull();
    expect(config.pricingVersion()).toBeNull();
  });

  it('keeps decimal budgets and clamps out-of-range values', () => {
    process.env.ORION_TENANT_MONTHLY_BUDGET_USD = '2.5';
    process.env.ORION_TURN_RESERVE_USD = '99';
    process.env.ORION_MAX_TOOL_ROUNDS = '0';
    const config = new OrionConfigService();
    expect(config.tenantMonthlyBudgetUsd).toBe(2.5);
    expect(config.turnReserveUsd).toBe(5);
    expect(config.maxRounds).toBe(1);
  });
});
