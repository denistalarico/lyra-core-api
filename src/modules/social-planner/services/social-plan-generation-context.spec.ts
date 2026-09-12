import { DEFAULT_SOCIAL_PLANNER_SETTINGS } from '../social-planner.defaults';
import { DEFAULT_SOCIAL_PUBLISHING_CADENCE } from '../social-publishing-cadence.defaults';
import type { SocialPlanEntity } from '../entities';
import type { ResolvedCommemorativeDate } from './commemorative-dates.resolver';
import { EMPTY_SOCIAL_BRAND_CONTEXT } from './social-brand-context.port';
import {
  buildPlanGenerationContext,
  planGenerationVocabulary,
} from './social-plan-generation-context';

function plan(overrides: Partial<SocialPlanEntity> = {}): SocialPlanEntity {
  return {
    id: 'plan-1',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    agencyClientId: null,
    title: 'Setembro 2026',
    periodStart: '2026-09-01',
    periodEnd: '2026-09-30',
    status: 'draft',
    primaryObjective: null,
    strategyMode: null,
    summary: null,
    ...overrides,
  } as SocialPlanEntity;
}

const settings = DEFAULT_SOCIAL_PLANNER_SETTINGS;
const cadence = DEFAULT_SOCIAL_PUBLISHING_CADENCE;

function build(
  overrides: Partial<Parameters<typeof buildPlanGenerationContext>[0]> = {},
  maxChars = 12_000,
): string {
  return buildPlanGenerationContext(
    {
      plan: plan(),
      settings,
      cadence,
      brand: EMPTY_SOCIAL_BRAND_CONTEXT,
      commemorativeDates: [],
      commemorativeStoryOnly: false,
      itemCount: 8,
      ...overrides,
    },
    maxChars,
  );
}

describe('buildPlanGenerationContext', () => {
  it('states the period and the requested item count', () => {
    const context = build();

    expect(context).toContain('2026-09-01 a 2026-09-30');
    expect(context).toContain('Quantidade de peças a gerar: 8');
  });

  it('never leaks the scope triple or any identifier', () => {
    const context = build({
      plan: plan({ agencyClientId: 'client-secret-uuid' }),
    });

    expect(context).not.toContain('tenant-1');
    expect(context).not.toContain('workspace-1');
    expect(context).not.toContain('client-secret-uuid');
    expect(context).not.toContain('plan-1');
  });

  it('sends brand facts that ground the copy', () => {
    const context = build({
      brand: {
        ...EMPTY_SOCIAL_BRAND_CONTEXT,
        publicName: 'Padaria Aurora',
        valueProposition: 'Pão fresco de fermentação natural',
        targetAudience: 'Famílias do bairro',
        city: 'Campinas',
        country: 'BR',
        businessMode: 'restaurants_food',
      },
    });

    expect(context).toContain('Padaria Aurora');
    expect(context).toContain('Pão fresco de fermentação natural');
    expect(context).toContain('Famílias do bairro');
    expect(context).toContain('Campinas');
    expect(context).toContain('restaurants_food');
  });

  it('omits the brand section entirely when nothing is configured', () => {
    expect(build()).not.toContain('== MARCA ==');
  });

  it('renames always_on to the label the UI shows', () => {
    const context = build({ plan: plan({ strategyMode: 'always_on' }) });

    expect(context).toContain('Posts para Redes Sociais');
    expect(context).not.toContain('Always-on');
  });

  it('lists only enabled taxonomy entries', () => {
    const context = build({
      settings: {
        ...settings,
        contentTypes: [
          { key: 'informative', label: 'Informativo', enabled: true },
          { key: 'meme', label: 'Meme', enabled: false },
        ],
      },
    });

    expect(context).toContain('informative (Informativo)');
    expect(context).not.toContain('meme (Meme)');
  });

  it('lists selected commemorative dates with their keys', () => {
    const dates: ResolvedCommemorativeDate[] = [
      {
        key: 'br_fathers_day',
        label: 'Dia dos Pais',
        date: '2026-08-09',
        country: 'BR',
        significance: 'national',
      },
    ];

    const context = build({ commemorativeDates: dates });

    expect(context).toContain('2026-08-09 — Dia dos Pais');
    expect(context).toContain('br_fathers_day');
    expect(context).toContain('data nacional');
  });

  it('states the story-only rule only when it was asked for', () => {
    const dates: ResolvedCommemorativeDate[] = [
      {
        key: 'christmas',
        label: 'Natal',
        date: '2026-12-25',
        country: 'GLOBAL',
        significance: 'national',
      },
    ];

    expect(
      build({ commemorativeDates: dates, commemorativeStoryOnly: true }),
    ).toContain('apenas Story');

    expect(
      build({ commemorativeDates: dates, commemorativeStoryOnly: false }),
    ).not.toContain('apenas Story');
  });

  it('truncates on a line boundary rather than mid-sentence', () => {
    const context = build({}, 120);

    expect(context.length).toBeLessThanOrEqual(120);
    // Every retained line must be whole.
    for (const line of context.split('\n'))
      expect(line).not.toMatch(/\s$/);
  });
});

describe('planGenerationVocabulary', () => {
  it('offers only enabled catalog keys', () => {
    const vocabulary = planGenerationVocabulary(
      {
        ...settings,
        objectives: [
          { key: 'awareness', label: 'Reconhecimento', enabled: true },
          { key: 'leads', label: 'Leads', enabled: false },
        ],
      },
      cadence,
      [],
    );

    expect(vocabulary.objectives).toEqual(['awareness']);
  });

  it('offers only enabled channels', () => {
    const vocabulary = planGenerationVocabulary(
      settings,
      {
        ...cadence,
        channels: [
          { channel: 'instagram', enabled: true, frequencyPerMonth: null, slots: [] },
          { channel: 'tiktok', enabled: false, frequencyPerMonth: null, slots: [] },
        ],
      },
      [],
    );

    expect(vocabulary.channels).toEqual(['instagram']);
  });

  it('offers exactly the commemorative keys that were resolved', () => {
    const vocabulary = planGenerationVocabulary(settings, cadence, [
      {
        key: 'christmas',
        label: 'Natal',
        date: '2026-12-25',
        country: 'GLOBAL',
        significance: 'national',
      },
    ]);

    expect(vocabulary.commemorativeDateKeys).toEqual(['christmas']);
  });

  it('always offers the canonical funnel stages', () => {
    const vocabulary = planGenerationVocabulary(settings, cadence, []);

    expect(vocabulary.funnelStages).toEqual([
      'discovery',
      'recognition',
      'consideration',
      'decision',
    ]);
  });
});
