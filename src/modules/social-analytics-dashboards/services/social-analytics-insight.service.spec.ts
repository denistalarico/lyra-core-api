import type { CompanyAwareScope } from '../../../common/context/company-aware-scope';
import { SocialAnalyticsInsightConfigService } from './social-analytics-insight-config.service';
import { SocialAnalyticsInsightError } from './social-analytics-insight.errors';
import { SocialAnalyticsInsightProvider } from './social-analytics-insight.provider';
import {
  SocialAnalyticsInsightService,
  type SocialAnalyticsInsightRequest,
} from './social-analytics-insight.service';

const scope: CompanyAwareScope = {
  tenantId: '10000000-0000-4000-8000-000000000001',
  workspaceId: '20000000-0000-4000-8000-000000000001',
  agencyClientId: '30000000-0000-4000-8000-000000000001',
  companyContextId: '31000000-0000-4000-8000-000000000001',
};

const request: SocialAnalyticsInsightRequest = {
  sectionTitle: 'Ads',
  channelLabel: 'Meta Ads',
  since: '2026-09-01',
  until: '2026-09-30',
  metrics: [{ label: 'Valor gasto', value: 'R$ 1.234,56', description: null }],
};

/**
 * The config is built from `process.env`, so each test sets the variables it
 * needs and the service is constructed afterwards. Restoring the environment
 * matters because a leaked `live` mode would make an unrelated spec try to open
 * a socket.
 */
function withEnv<T>(vars: Record<string, string | undefined>, run: () => T): T {
  const previous = { ...process.env };

  // Deleted, not assigned: `process.env.X = undefined` stores the *string*
  // "undefined", which a `?? 'disabled'` fallback happily accepts and then
  // rejects as an invalid mode. An absent variable is the case being tested.
  for (const [name, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }

  try {
    return run();
  } finally {
    process.env = previous;
  }
}

function buildService(usage: { inputTokens?: number; outputTokens?: number }) {
  const config = new SocialAnalyticsInsightConfigService();
  const provider = {
    generate: jest.fn().mockResolvedValue({
      body: 'Uma análise.',
      provider: 'mock',
      model: 'mock-insight-v1',
      promptVersion: 'analytics-insight-v1',
      usage,
      latencyMs: 12,
      attempts: 1,
    }),
  } as unknown as SocialAnalyticsInsightProvider;

  return {
    service: new SocialAnalyticsInsightService(config, provider),
    provider,
    config,
  };
}

describe('SocialAnalyticsInsightConfigService', () => {
  it('defaults to disabled so no deployment starts paying for a provider', () => {
    withEnv({ SOCIAL_ANALYTICS_INSIGHT_PROVIDER_MODE: undefined }, () => {
      const config = new SocialAnalyticsInsightConfigService();

      expect(config.mode).toBe('disabled');
      expect(config.available).toBe(false);
    });
  });

  it('refuses to boot in live mode without a key', () => {
    withEnv(
      {
        SOCIAL_ANALYTICS_INSIGHT_PROVIDER_MODE: 'live',
        SOCIAL_ANALYTICS_INSIGHT_PROVIDER_API_KEY: '',
        OPENAI_API_KEY: '',
      },
      () => {
        const config = new SocialAnalyticsInsightConfigService();

        expect(() => config.onModuleInit()).toThrow(
          'social_analytics_insight_live_configuration_missing',
        );
      },
    );
  });

  it('refuses a non-HTTPS remote endpoint', () => {
    withEnv(
      {
        SOCIAL_ANALYTICS_INSIGHT_PROVIDER_MODE: 'live',
        SOCIAL_ANALYTICS_INSIGHT_PROVIDER_API_KEY: 'key',
        SOCIAL_ANALYTICS_INSIGHT_PROVIDER_BASE_URL: 'http://example.com/v1',
      },
      () => {
        const config = new SocialAnalyticsInsightConfigService();

        expect(() => config.onModuleInit()).toThrow(
          'social_analytics_insight_endpoint_must_use_https',
        );
      },
    );
  });

  it('does not fall back to the platform OpenAI key for a third-party endpoint', () => {
    // The guard that stops a misconfigured base URL from shipping the
    // platform's credential somewhere else.
    withEnv(
      {
        SOCIAL_ANALYTICS_INSIGHT_PROVIDER_API_KEY: '',
        SOCIAL_ANALYTICS_INSIGHT_PROVIDER_BASE_URL:
          'https://not-openai.test/v1',
        OPENAI_API_KEY: 'platform-key',
      },
      () => {
        expect(new SocialAnalyticsInsightConfigService().apiKey).toBe('');
      },
    );
  });

  it('rejects an unknown mode rather than guessing one', () => {
    withEnv({ SOCIAL_ANALYTICS_INSIGHT_PROVIDER_MODE: 'sometimes' }, () => {
      expect(() => new SocialAnalyticsInsightConfigService()).toThrow(
        'social_analytics_insight_provider_mode_invalid',
      );
    });
  });
});

describe('SocialAnalyticsInsightService', () => {
  it('records an estimated cost in cents from the configured rates', async () => {
    await withEnv(
      {
        SOCIAL_ANALYTICS_INSIGHT_PROVIDER_MODE: 'mock',
        SOCIAL_ANALYTICS_INSIGHT_INPUT_CENTS_PER_MTOK: '1000',
        SOCIAL_ANALYTICS_INSIGHT_OUTPUT_CENTS_PER_MTOK: '2000',
      },
      async () => {
        const { service } = buildService({
          inputTokens: 1_000_000,
          outputTokens: 500_000,
        });

        const result = await service.generate(scope, request);

        // 1M input at 1000c/M plus 0.5M output at 2000c/M = 2000c.
        expect(result.costCents).toBe(2000);
        expect(result.costIsEstimated).toBe(true);
      },
    );
  });

  it('rounds a sub-cent run up, so a retroactive charge does not miss it', async () => {
    await withEnv(
      { SOCIAL_ANALYTICS_INSIGHT_PROVIDER_MODE: 'mock' },
      async () => {
        const { service } = buildService({ inputTokens: 10, outputTokens: 5 });

        expect((await service.generate(scope, request)).costCents).toBe(1);
      },
    );
  });

  it('records zero when the provider reported no usage at all', async () => {
    await withEnv(
      { SOCIAL_ANALYTICS_INSIGHT_PROVIDER_MODE: 'mock' },
      async () => {
        const { service } = buildService({});

        expect((await service.generate(scope, request)).costCents).toBe(0);
      },
    );
  });

  it('carries the model and a generation timestamp back to the card', async () => {
    await withEnv(
      { SOCIAL_ANALYTICS_INSIGHT_PROVIDER_MODE: 'mock' },
      async () => {
        const { service } = buildService({});
        const result = await service.generate(scope, request);

        expect(result.model).toBe('mock-insight-v1');
        expect(result.body).toBe('Uma análise.');
        expect(Number.isNaN(Date.parse(result.generatedAt))).toBe(false);
      },
    );
  });

  it('reports availability from the configured mode', () => {
    withEnv({ SOCIAL_ANALYTICS_INSIGHT_PROVIDER_MODE: 'disabled' }, () => {
      expect(buildService({}).service.available).toBe(false);
    });

    withEnv({ SOCIAL_ANALYTICS_INSIGHT_PROVIDER_MODE: 'mock' }, () => {
      expect(buildService({}).service.available).toBe(true);
    });
  });

  it('maps a disabled provider to 503 and not to a generic failure', () => {
    // The frontend disables the button on this answer; a 500 would read as an
    // outage in a system that is working as configured.
    const error = new SocialAnalyticsInsightError('insight_provider_disabled');

    expect(SocialAnalyticsInsightService.statusFor(error)).toBe(503);
    expect(SocialAnalyticsInsightService.messageFor(error)).toContain(
      'não está habilitada',
    );
  });

  it('maps rate limiting to 429 and a schema failure to 502', () => {
    expect(
      SocialAnalyticsInsightService.statusFor(
        new SocialAnalyticsInsightError('insight_provider_rate_limited'),
      ),
    ).toBe(429);

    expect(
      SocialAnalyticsInsightService.statusFor(
        new SocialAnalyticsInsightError('insight_schema_invalid'),
      ),
    ).toBe(502);

    expect(
      SocialAnalyticsInsightService.statusFor(
        new SocialAnalyticsInsightError('insight_context_empty'),
      ),
    ).toBe(400);
  });
});

describe('SocialAnalyticsInsightProvider', () => {
  it('refuses to call anything while disabled', async () => {
    await withEnv(
      { SOCIAL_ANALYTICS_INSIGHT_PROVIDER_MODE: 'disabled' },
      async () => {
        const provider = new SocialAnalyticsInsightProvider(
          new SocialAnalyticsInsightConfigService(),
        );

        await expect(
          provider.generate({
            idempotencyKey: 'k',
            sectionTitle: 'Ads',
            channelLabel: 'Meta Ads',
            period: { since: '2026-09-01', until: '2026-09-30' },
            metrics: request.metrics,
          }),
        ).rejects.toMatchObject({ code: 'insight_provider_disabled' });
      },
    );
  });

  it('refuses an empty metric block instead of asking about nothing', async () => {
    await withEnv(
      { SOCIAL_ANALYTICS_INSIGHT_PROVIDER_MODE: 'mock' },
      async () => {
        const provider = new SocialAnalyticsInsightProvider(
          new SocialAnalyticsInsightConfigService(),
        );

        await expect(
          provider.generate({
            idempotencyKey: 'k',
            sectionTitle: 'Ads',
            channelLabel: 'Meta Ads',
            period: { since: '2026-09-01', until: '2026-09-30' },
            metrics: [],
          }),
        ).rejects.toMatchObject({ code: 'insight_context_empty' });
      },
    );
  });

  it('marks its mock output as synthetic in the text itself', async () => {
    // A mock body that read like a real analysis would end up frozen in a card
    // and then in a client's PDF with nothing flagging it as invented.
    await withEnv(
      { SOCIAL_ANALYTICS_INSIGHT_PROVIDER_MODE: 'mock' },
      async () => {
        const provider = new SocialAnalyticsInsightProvider(
          new SocialAnalyticsInsightConfigService(),
        );

        const result = await provider.generate({
          idempotencyKey: 'k',
          sectionTitle: 'Ads',
          channelLabel: 'Meta Ads',
          period: { since: '2026-09-01', until: '2026-09-30' },
          metrics: request.metrics,
        });

        expect(result.body).toContain('mock');
        expect(result.provider).toBe('mock');
      },
    );
  });
});
