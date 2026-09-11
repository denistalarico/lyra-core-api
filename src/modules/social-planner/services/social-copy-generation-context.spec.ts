import type { SocialPlannerSettings } from '../contracts';
import type {
  SocialContentDestinationEntity,
  SocialContentItemEntity,
  SocialPlanEntity,
} from '../entities';
import { DEFAULT_SOCIAL_PLANNER_SETTINGS } from '../social-planner.defaults';
import {
  buildCopyGenerationContext,
  defaultFieldsFor,
} from './social-copy-generation-context';

const TENANT = '11111111-1111-4111-8111-111111111111';
const WORKSPACE = '22222222-2222-4222-8222-222222222222';
const CLIENT = '33333333-3333-4333-8333-333333333333';

function settings(): SocialPlannerSettings {
  return JSON.parse(
    JSON.stringify(DEFAULT_SOCIAL_PLANNER_SETTINGS),
  ) as SocialPlannerSettings;
}

function plan(): SocialPlanEntity {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    tenantId: TENANT,
    workspaceId: WORKSPACE,
    agencyClientId: CLIENT,
    title: 'Plano de Setembro',
    periodStart: '2026-09-01',
    periodEnd: '2026-09-30',
    status: 'active',
    primaryObjective: 'Aumentar consideração',
    strategyMode: 'balanced',
    summary: 'Foco em prova social.',
  } as unknown as SocialPlanEntity;
}

function item(overrides: Partial<SocialContentItemEntity> = {}) {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    tenantId: TENANT,
    workspaceId: WORKSPACE,
    agencyClientId: CLIENT,
    planId: '44444444-4444-4444-8444-444444444444',
    title: 'Depoimento da cliente',
    theme: 'Prova social',
    brief: 'Mostrar o antes e depois.',
    keyMessage: 'Resultado real em 30 dias.',
    copy: null,
    caption: null,
    script: null,
    cta: null,
    hashtags: [],
    firstComment: null,
    funnelStage: 'consideration',
    contentType: 'testimonial',
    objective: 'engagement',
    creativeFormat: 'feed_image',
    plannedDate: '2026-09-12',
    campaignInstanceId: null,
    editorialPillarId: null,
    createdById: '66666666-6666-4666-8666-666666666666',
    updatedById: '66666666-6666-4666-8666-666666666666',
    ...overrides,
  } as unknown as SocialContentItemEntity;
}

function destination(
  channel: string,
  placement: string,
): SocialContentDestinationEntity {
  return {
    id: `${channel}-${placement}`,
    tenantId: TENANT,
    workspaceId: WORKSPACE,
    agencyClientId: CLIENT,
    contentItemId: '55555555-5555-4555-8555-555555555555',
    channel,
    placement,
    plannedAt: null,
  } as unknown as SocialContentDestinationEntity;
}

describe('buildCopyGenerationContext', () => {
  const MAX = 12_000;

  it('sends the editorial fields a copywriter would be briefed with', () => {
    const context = buildCopyGenerationContext(
      {
        plan: plan(),
        item: item(),
        destinations: [destination('instagram', 'feed')],
        settings: settings(),
        campaignTitle: 'Campanha de aniversário',
        pillarName: 'Autoridade',
      },
      MAX,
    );

    expect(context).toContain('Plano de Setembro');
    expect(context).toContain('Depoimento da cliente');
    expect(context).toContain('Prova social');
    expect(context).toContain('Mostrar o antes e depois.');
    expect(context).toContain('Resultado real em 30 dias.');
    expect(context).toContain('instagram/feed');
    expect(context).toContain('Campanha de aniversário');
    expect(context).toContain('Autoridade');
  });

  /**
   * The security property of this builder. What reaches a paid third party is
   * not a formatting detail, so the ids are asserted absent by value rather
   * than by reading the code.
   */
  it('never sends scope ids, row ids or actor ids to the provider', () => {
    const context = buildCopyGenerationContext(
      {
        plan: plan(),
        item: item(),
        destinations: [destination('instagram', 'feed')],
        settings: settings(),
        campaignTitle: null,
        pillarName: null,
      },
      MAX,
    );

    for (const id of [
      TENANT,
      WORKSPACE,
      CLIENT,
      '44444444-4444-4444-8444-444444444444',
      '55555555-5555-4555-8555-555555555555',
      '66666666-6666-4666-8666-666666666666',
    ]) {
      expect(context).not.toContain(id);
    }
  });

  it('omits editorial fields that are empty rather than sending empty labels', () => {
    const context = buildCopyGenerationContext(
      {
        plan: plan(),
        item: item({ brief: null, keyMessage: null, theme: null }),
        destinations: [],
        settings: settings(),
        campaignTitle: null,
        pillarName: null,
      },
      MAX,
    );

    expect(context).not.toContain('Brief:');
    expect(context).not.toContain('Mensagem-chave:');
    expect(context).not.toContain('Tema:');
    expect(context).not.toContain('Destinos:');
  });

  /**
   * Truncation on a line boundary matters: a prompt cut mid-sentence can invert
   * the meaning of the instruction it was in the middle of.
   */
  it('truncates on a line boundary and never past the budget', () => {
    const context = buildCopyGenerationContext(
      {
        plan: plan(),
        item: item({ brief: 'x'.repeat(5_000) }),
        destinations: [],
        settings: settings(),
        campaignTitle: null,
        pillarName: null,
      },
      120,
    );

    expect(context.length).toBeLessThanOrEqual(120);
    for (const line of context.split('\n'))
      expect(line.endsWith('…')).toBe(false);
    expect(context).toContain('Plano de Setembro');
  });

  it('grounds generation on the agency hashtag and CTA standards', () => {
    const configured = settings();
    configured.hashtagDefaults.mandatory = ['#lyra', '#agencia'];
    configured.ctaDefaults = { engagement: ['Comente abaixo', 'Salve o post'] };

    const context = buildCopyGenerationContext(
      {
        plan: plan(),
        item: item(),
        destinations: [],
        settings: configured,
        campaignTitle: null,
        pillarName: null,
      },
      MAX,
    );

    expect(context).toContain('#lyra #agencia');
    expect(context).toContain('Comente abaixo');
  });
});

describe('defaultFieldsFor', () => {
  it('asks for copy, caption, CTA and hashtags on an ordinary feed post', () => {
    const fields = defaultFieldsFor(
      item(),
      [destination('instagram', 'feed')],
      settings(),
    );

    expect(fields).toContain('copy');
    expect(fields).toContain('caption');
    expect(fields).toContain('cta');
    expect(fields).toContain('hashtags');
    expect(fields).not.toContain('script');
  });

  it('adds a script only for video formats and placements', () => {
    expect(
      defaultFieldsFor(
        item({ creativeFormat: 'reel' }),
        [destination('instagram', 'reel')],
        settings(),
      ),
    ).toContain('script');

    expect(
      defaultFieldsFor(
        item({ creativeFormat: 'feed_image' }),
        [destination('instagram', 'feed')],
        settings(),
      ),
    ).not.toContain('script');
  });

  /**
   * E4 normalized the vocabulary to `reel`/`story`, but rows written before that
   * still hold the plural spellings. A legacy row must not silently lose its
   * script.
   */
  it('still recognizes the legacy plural video vocabulary', () => {
    expect(
      defaultFieldsFor(
        item({ creativeFormat: 'reels' }),
        [destination('instagram', 'reels')],
        settings(),
      ),
    ).toContain('script');
  });

  /**
   * Story carries no caption. E5 already disables the field on the content page
   * for exactly this case; proposing one here would stage something the UI
   * refuses to show.
   */
  it('omits caption and first comment when every destination is a Story', () => {
    const fields = defaultFieldsFor(
      item(),
      [destination('instagram', 'story'), destination('facebook', 'story')],
      settings(),
    );

    expect(fields).not.toContain('caption');
    expect(fields).not.toContain('firstComment');
  });

  it('keeps the caption when only one of several destinations is a Story', () => {
    const fields = defaultFieldsFor(
      item(),
      [destination('instagram', 'story'), destination('instagram', 'feed')],
      settings(),
    );

    expect(fields).toContain('caption');
  });

  it('asks for a first comment only when the agency enabled it', () => {
    const enabled = settings();
    enabled.firstCommentDefaults.enabled = true;
    expect(
      defaultFieldsFor(item(), [destination('instagram', 'feed')], enabled),
    ).toContain('firstComment');

    const disabled = settings();
    disabled.firstCommentDefaults.enabled = false;
    expect(
      defaultFieldsFor(item(), [destination('instagram', 'feed')], disabled),
    ).not.toContain('firstComment');
  });
});
