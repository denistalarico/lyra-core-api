import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import type {
  SocialContentDestinationEntity,
  SocialContentItemEntity,
  SocialCopyGenerationRunEntity,
  SocialPlanEntity,
} from '../entities';
import { DEFAULT_SOCIAL_PLANNER_SETTINGS } from '../social-planner.defaults';
import { DEFAULT_SOCIAL_PUBLISHING_CADENCE } from '../social-publishing-cadence.defaults';
import { EMPTY_SOCIAL_BRAND_CONTEXT } from './social-brand-context.port';
import type { SocialBrandContextPort } from './social-brand-context.port';
import type { SocialCopyGenerationConfigService } from './social-copy-generation-config.service';
import type { SocialCopyGenerationService } from './social-copy-generation.service';
import type { SocialPlanGenerationProvider } from './social-plan-generation-provider';
import { SocialPlanGenerationService } from './social-plan-generation.service';
import type { SocialPlannerSettingsService } from './social-planner-settings.service';
import type { SocialPublishingCadenceService } from './social-publishing-cadence.service';
import type { SocialPlannerScope } from './social-planner.service';

const scope: SocialPlannerScope = {
  tenantId: 'tenant-1',
  workspaceId: 'workspace-1',
  agencyClientId: null,
  companyContextId: null,
};

const plan = {
  id: 'plan-1',
  tenantId: 'tenant-1',
  workspaceId: 'workspace-1',
  agencyClientId: null,
  title: 'Setembro',
  periodStart: '2026-09-01',
  periodEnd: '2026-09-30',
  status: 'draft',
  primaryObjective: null,
  strategyMode: null,
  summary: null,
} as SocialPlanEntity;

function generatedItem(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Peça',
    theme: null,
    plannedDate: '2026-09-10',
    plannedTime: null,
    channels: [],
    placement: null,
    creativeFormat: null,
    funnelStage: null,
    contentType: null,
    objective: null,
    commemorativeDateKey: null,
    ...overrides,
  };
}

describe('SocialPlanGenerationService', () => {
  let plansRepository: { findOne: jest.Mock };
  let contentRepository: {
    count: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let destinationsRepository: { create: jest.Mock; save: jest.Mock };
  let runsRepository: { create: jest.Mock; save: jest.Mock; update: jest.Mock };
  let provider: { generate: jest.Mock };
  let settingsService: { getSettings: jest.Mock };
  let cadenceService: { getCadence: jest.Mock };
  let brandContext: { load: jest.Mock };
  let copyGenerationService: { dailyBudgetRemaining: jest.Mock };
  let config: SocialCopyGenerationConfigService;
  let service: SocialPlanGenerationService;

  function build(
    configOverrides: Partial<SocialCopyGenerationConfigService> = {},
  ) {
    config = {
      mode: 'live',
      reserveCents: 5,
      maxContextChars: 12_000,
      inputCentsPerMillionTokens: 125,
      outputCentsPerMillionTokens: 1_000,
      ...configOverrides,
    } as SocialCopyGenerationConfigService;

    service = new SocialPlanGenerationService(
      plansRepository as unknown as Repository<SocialPlanEntity>,
      contentRepository as unknown as Repository<SocialContentItemEntity>,
      destinationsRepository as unknown as Repository<SocialContentDestinationEntity>,
      runsRepository as unknown as Repository<SocialCopyGenerationRunEntity>,
      provider as unknown as SocialPlanGenerationProvider,
      config,
      settingsService as unknown as SocialPlannerSettingsService,
      cadenceService as unknown as SocialPublishingCadenceService,
      brandContext as unknown as SocialBrandContextPort,
      copyGenerationService as unknown as SocialCopyGenerationService,
    );
  }

  beforeEach(() => {
    plansRepository = { findOne: jest.fn().mockResolvedValue(plan) };

    contentRepository = {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn((row: unknown) => row),
      save: jest.fn((rows: unknown[]) =>
        Promise.resolve(
          (rows as Array<Record<string, unknown>>).map((row, index) => ({
            ...row,
            id: `content-${index}`,
          })),
        ),
      ),
    };

    destinationsRepository = {
      create: jest.fn((row: unknown) => row),
      save: jest.fn((rows: unknown[]) => Promise.resolve(rows)),
    };

    runsRepository = {
      create: jest.fn((row: unknown) => row),
      save: jest.fn((row: Record<string, unknown>) =>
        Promise.resolve({ ...row, id: 'run-1' }),
      ),
      update: jest.fn().mockResolvedValue(undefined),
    };

    provider = {
      generate: jest.fn().mockResolvedValue({
        items: [generatedItem()],
        provider: 'openai-compatible',
        model: 'gpt-test',
        promptVersion: 'planner-plan-v1',
        usage: { inputTokens: 1_000, outputTokens: 500 },
        latencyMs: 900,
        attempts: 1,
      }),
    };

    settingsService = {
      getSettings: jest
        .fn()
        .mockResolvedValue({ settings: DEFAULT_SOCIAL_PLANNER_SETTINGS }),
    };

    cadenceService = {
      getCadence: jest
        .fn()
        .mockResolvedValue({ cadence: DEFAULT_SOCIAL_PUBLISHING_CADENCE }),
    };

    brandContext = {
      load: jest.fn().mockResolvedValue(EMPTY_SOCIAL_BRAND_CONTEXT),
    };

    copyGenerationService = {
      dailyBudgetRemaining: jest.fn().mockResolvedValue(500),
    };

    build();
  });

  it('refuses when generation is disabled for the deployment', async () => {
    build({ mode: 'disabled' });

    await expect(
      service.generatePlan(scope, 'plan-1', 'user-1', {}),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(provider.generate).not.toHaveBeenCalled();
  });

  it('refuses when the daily budget is exhausted, before paying for a call', async () => {
    copyGenerationService.dailyBudgetRemaining.mockResolvedValue(1);

    await expect(
      service.generatePlan(scope, 'plan-1', 'user-1', {}),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(provider.generate).not.toHaveBeenCalled();
  });

  it('refuses a plan outside the scope', async () => {
    plansRepository.findOne.mockResolvedValue(null);

    await expect(
      service.generatePlan(scope, 'plan-1', 'user-1', {}),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('creates content items without any copy', async () => {
    const result = await service.generatePlan(scope, 'plan-1', 'user-1', {});

    expect(result.created).toBe(1);

    const [rows] = contentRepository.save.mock.calls[0] as [
      Array<Record<string, unknown>>,
    ];
    expect(rows[0]).toMatchObject({
      copy: null,
      caption: null,
      script: null,
      cta: null,
      hashtags: [],
      firstComment: null,
      planningStatus: 'planned',
    });
  });

  it('clamps a date the model placed outside the period', async () => {
    provider.generate.mockResolvedValue({
      items: [
        generatedItem({ plannedDate: '2026-08-01' }),
        generatedItem({ plannedDate: '2026-12-31' }),
      ],
      provider: 'openai-compatible',
      model: 'gpt-test',
      promptVersion: 'planner-plan-v1',
      usage: {},
      latencyMs: 10,
      attempts: 1,
    });

    await service.generatePlan(scope, 'plan-1', 'user-1', {});

    const [rows] = contentRepository.save.mock.calls[0] as [
      Array<Record<string, unknown>>,
    ];
    expect(rows[0].plannedDate).toBe('2026-09-01');
    expect(rows[1].plannedDate).toBe('2026-09-30');
  });

  it('pins a commemorative item to the real date, not the model’s', async () => {
    provider.generate.mockResolvedValue({
      items: [
        generatedItem({
          plannedDate: '2026-09-02',
          commemorativeDateKey: 'br_independence',
        }),
      ],
      provider: 'openai-compatible',
      model: 'gpt-test',
      promptVersion: 'planner-plan-v1',
      usage: {},
      latencyMs: 10,
      attempts: 1,
    });

    await service.generatePlan(scope, 'plan-1', 'user-1', {
      commemorativeDateKeys: ['br_independence'],
    });

    const [rows] = contentRepository.save.mock.calls[0] as [
      Array<Record<string, unknown>>,
    ];
    // Brazilian Independence Day is September 7th.
    expect(rows[0].plannedDate).toBe('2026-09-07');
  });

  it('forces commemorative items to Story when the operator asked for it', async () => {
    provider.generate.mockResolvedValue({
      items: [
        generatedItem({
          creativeFormat: 'carousel',
          placement: 'feed',
          channels: ['instagram'],
          commemorativeDateKey: 'br_independence',
        }),
        generatedItem({ creativeFormat: 'carousel', channels: ['instagram'] }),
      ],
      provider: 'openai-compatible',
      model: 'gpt-test',
      promptVersion: 'planner-plan-v1',
      usage: {},
      latencyMs: 10,
      attempts: 1,
    });

    await service.generatePlan(scope, 'plan-1', 'user-1', {
      commemorativeDateKeys: ['br_independence'],
      commemorativeStoryOnly: true,
    });

    const [rows] = contentRepository.save.mock.calls[0] as [
      Array<Record<string, unknown>>,
    ];
    expect(rows[0].creativeFormat).toBe('story');
    // A non-commemorative item keeps whatever the model chose.
    expect(rows[1].creativeFormat).toBe('carousel');

    const [destinations] = destinationsRepository.save.mock.calls[0] as [
      Array<Record<string, unknown>>,
    ];
    expect(destinations[0].placement).toBe('story');
  });

  it('records provenance and an estimated cost on the run', async () => {
    await service.generatePlan(scope, 'plan-1', 'user-1', {});

    const [, update] = runsRepository.update.mock.calls[0] as [
      unknown,
      Record<string, unknown>,
    ];

    expect(update).toMatchObject({
      status: 'succeeded',
      provider: 'openai-compatible',
      model: 'gpt-test',
      inputTokens: 1_000,
      outputTokens: 500,
      costIsEstimated: true,
    });
    // 1000 input @125c/Mtok + 500 output @1000c/Mtok = 0.625c, floored at the reserve.
    expect(update.costCents).toBe(5);
  });

  it('charges the reserve up front so concurrent requests cannot all pass', async () => {
    await service.generatePlan(scope, 'plan-1', 'user-1', {});

    const [run] = runsRepository.save.mock.calls[0] as [
      Record<string, unknown>,
    ];
    expect(run).toMatchObject({
      runKind: 'plan_grid',
      contentItemId: null,
      costCents: 5,
      status: 'processing',
    });
  });

  it('marks the run failed and keeps the reserve when the provider fails', async () => {
    provider.generate.mockRejectedValue(
      new Error('generation_provider_timeout'),
    );

    await expect(
      service.generatePlan(scope, 'plan-1', 'user-1', {}),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    const [, update] = runsRepository.update.mock.calls[0] as [
      unknown,
      Record<string, unknown>,
    ];
    expect(update).toMatchObject({
      status: 'failed',
      lastError: 'generation_provider_timeout',
    });
    // No content was written for a failed generation.
    expect(contentRepository.save).not.toHaveBeenCalled();
  });

  it('scales the default item count by the plan length', async () => {
    plansRepository.findOne.mockResolvedValue({
      ...plan,
      periodStart: '2026-09-01',
      periodEnd: '2026-09-15',
    });

    await service.generatePlan(scope, 'plan-1', 'user-1', {});

    const [request] = provider.generate.mock.calls[0] as [
      { itemCount: number },
    ];
    // Default monthly volume is 8; half a month asks for about half.
    expect(request.itemCount).toBe(4);
  });

  it('honours an explicit item count', async () => {
    await service.generatePlan(scope, 'plan-1', 'user-1', { itemCount: 21 });

    const [request] = provider.generate.mock.calls[0] as [
      { itemCount: number },
    ];
    expect(request.itemCount).toBe(21);
  });

  it('appends after existing content rather than restarting sort order', async () => {
    contentRepository.count.mockResolvedValue(7);

    await service.generatePlan(scope, 'plan-1', 'user-1', {});

    const [rows] = contentRepository.save.mock.calls[0] as [
      Array<Record<string, unknown>>,
    ];
    expect(rows[0].sortOrder).toBe(7);
  });

  it('creates one destination per channel the model chose', async () => {
    provider.generate.mockResolvedValue({
      items: [
        generatedItem({
          channels: ['instagram', 'facebook'],
          placement: 'feed',
          plannedTime: '09:30',
        }),
      ],
      provider: 'openai-compatible',
      model: 'gpt-test',
      promptVersion: 'planner-plan-v1',
      usage: {},
      latencyMs: 10,
      attempts: 1,
    });

    await service.generatePlan(scope, 'plan-1', 'user-1', {});

    const [destinations] = destinationsRepository.save.mock.calls[0] as [
      Array<Record<string, unknown>>,
    ];
    expect(destinations).toHaveLength(2);
    expect(destinations[0]).toMatchObject({
      channel: 'instagram',
      placement: 'feed',
      contentItemId: 'content-0',
    });
  });

  it('writes no destinations when the model chose no channel', async () => {
    await service.generatePlan(scope, 'plan-1', 'user-1', {});

    expect(destinationsRepository.save).not.toHaveBeenCalled();
  });
});

describe('listCommemorativeDates', () => {
  it('falls back to the brand country and business mode', async () => {
    const brandContext = {
      load: jest.fn().mockResolvedValue({
        ...EMPTY_SOCIAL_BRAND_CONTEXT,
        country: 'BR',
        businessMode: 'clinics_esthetics',
      }),
    };

    const service = new SocialPlanGenerationService(
      { findOne: jest.fn() } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      brandContext as unknown as SocialBrandContextPort,
      {} as never,
    );

    const result = await service.listCommemorativeDates(scope, {
      periodStart: '2026-10-01',
      periodEnd: '2026-10-31',
    });

    expect(result.country).toBe('BR');
    expect(result.businessMode).toBe('clinics_esthetics');
    expect(result.dates.map((date) => date.key)).toContain('br_dentist_day');
  });

  it('ignores a business mode that is not a real key', async () => {
    const brandContext = {
      load: jest.fn().mockResolvedValue(EMPTY_SOCIAL_BRAND_CONTEXT),
    };

    const service = new SocialPlanGenerationService(
      { findOne: jest.fn() } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      brandContext as unknown as SocialBrandContextPort,
      {} as never,
    );

    const result = await service.listCommemorativeDates(scope, {
      periodStart: '2026-10-01',
      periodEnd: '2026-10-31',
      businessMode: 'not_a_mode',
    });

    expect(result.businessMode).toBeNull();
    // Sector dates are still offered, rather than filtered to nothing.
    expect(result.dates.length).toBeGreaterThan(0);
  });
});
