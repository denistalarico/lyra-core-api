import { SocialCampaignRecommendationConfigService } from './social-campaign-recommendation-config.service';
import {
  SocialCampaignRecommendationProvider,
  SOCIAL_CAMPAIGN_RECOMMENDATION_PROMPT_VERSION,
} from './social-campaign-recommendation.provider';

describe('SocialCampaignRecommendationProvider', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('keeps only cited local evidence and clamps confidence to data quality', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summary: 'Uma leitura local.',
                  recommendations: [
                    {
                      priority: 'high',
                      title: 'Revisar investimento',
                      rationale: 'O gasto observado merece revisão humana.',
                      evidenceKeys: ['account.current.spend', 'invented.fact'],
                      suggestedAction: 'Avalie manualmente a distribuição.',
                      expectedImpact: 'Maior clareza na alocação.',
                      confidence: 'high',
                      observationWindowDays: 14,
                      caveats: ['Não há previsão causal.'],
                    },
                  ],
                }),
              },
            },
          ],
          usage: { prompt_tokens: 120, completion_tokens: 80 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    ) as jest.MockedFunction<typeof fetch>;

    const config = {
      mode: 'live',
      endpoint: 'https://llm.example.test/v1',
      apiKey: 'secret',
      model: 'test-model',
      timeoutMs: 1_000,
      maxAttempts: 1,
    } as SocialCampaignRecommendationConfigService;
    const provider = new SocialCampaignRecommendationProvider(config);

    const result = await provider.generate({
      requestId: '37e211d5-21de-48e5-9d23-17373302f21a',
      evidence: { account: { spend: 1200 } },
      evidenceKeys: ['account.current.spend'],
      confidenceCeiling: 'low',
    });

    expect(result.recommendations).toHaveLength(1);
    expect(result.recommendations[0]?.evidenceKeys).toEqual([
      'account.current.spend',
    ]);
    expect(result.recommendations[0]?.confidence).toBe('low');
    expect(result.promptVersion).toBe(
      SOCIAL_CAMPAIGN_RECOMMENDATION_PROMPT_VERSION,
    );
    expect(result.usage).toEqual({
      inputTokens: 120,
      cachedInputTokens: undefined,
      outputTokens: 80,
    });
  });

  it('never asks the model to execute or invent provider changes', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            { message: { content: '{"summary":"Sem sugestão.","recommendations":[]}' } },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    global.fetch = fetchMock as jest.MockedFunction<typeof fetch>;
    const provider = new SocialCampaignRecommendationProvider({
      mode: 'live',
      endpoint: 'https://llm.example.test/v1',
      apiKey: 'secret',
      model: 'test-model',
      timeoutMs: 1_000,
      maxAttempts: 1,
    } as SocialCampaignRecommendationConfigService);

    await provider.generate({
      requestId: '37e211d5-21de-48e5-9d23-17373302f21a',
      evidence: { safe: true },
      evidenceKeys: ['safe.fact'],
      confidenceCeiling: 'medium',
    });

    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    const prompt = request.messages[0].content as string;
    expect(prompt).toContain('Nunca afirme que executou, pausou, publicou ou alterou');
    expect(prompt).toContain('Não gere payload, endpoint, comando de API');
    expect(request.messages[1].content).toBe('{"safe":true}');
  });
});
