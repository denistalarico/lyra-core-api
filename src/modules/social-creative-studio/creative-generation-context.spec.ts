import { BadRequestException, NotFoundException } from '@nestjs/common';
import type {
  SocialContentReferenceIdentity,
  SocialContentReferenceService,
} from '../social-planner/services/social-content-reference.service';
import type { SocialPlannerService } from '../social-planner/services/social-planner.service';
import type {
  CreativeStudioBrandContext,
  CreativeStudioBrandContextService,
} from './creative-brand-context.service';
import {
  buildGenerationContext,
  clip,
  CreativeGenerationContextService,
  generationContextRecord,
} from './creative-generation-context';
import type { CreativeStudioScope } from './creative-studio.scope';

const scopeA: CreativeStudioScope = {
  tenantId: '10000000-0000-4000-8000-000000000001',
  workspaceId: '20000000-0000-4000-8000-000000000001',
  agencyClientId: '30000000-0000-4000-8000-000000000001',
  companyContextId: '31000000-0000-4000-8000-000000000001',
};
const ITEM_ID = '40000000-0000-4000-8000-000000000001';

const EMPTY: CreativeStudioBrandContext = {
  palette: [],
  typography: [],
  guidelines: null,
  assets: [],
  references: [],
};
const BRAND: CreativeStudioBrandContext = {
  palette: [{ role: 'primary', hex: '#0B3D2E', label: 'Verde' }],
  typography: [{ role: 'heading', family: 'Montserrat', weights: [700] }],
  guidelines: 'Luz   quente,\n\nsem filtros.',
  assets: [
    {
      id: '50000000-0000-4000-8000-000000000002',
      kind: 'product',
      usage: 'asset',
      mimeType: 'image/png',
      width: 1,
      height: 1,
      metadata: {},
    },
    {
      id: '50000000-0000-4000-8000-000000000001',
      kind: 'logo',
      usage: 'asset',
      mimeType: 'image/png',
      width: 1,
      height: 1,
      metadata: {},
    },
  ],
  references: [],
};

type Item = NonNullable<Parameters<typeof buildGenerationContext>[0]['item']>;
const item = (patch: Partial<Item> = {}): Item =>
  ({
    id: ITEM_ID,
    planId: '41000000-0000-4000-8000-000000000001',
    title: 'Blend de inverno',
    theme: null,
    brief: 'Café   aconchegante',
    keyMessage: null,
    copy: null,
    caption: null,
    script: null,
    cta: null,
    hashtags: ['#cafe'],
    firstComment: 'primeiro comentário',
    currentRevisionId: '42000000-0000-4000-8000-000000000001',
    funnelStage: null,
    contentType: 'post',
    objective: null,
    creativeFormat: null,
    planningStatus: 'copy_ready',
    calendarOnly: false,
    plannedDate: '2026-10-10',
    sortOrder: 0,
    campaignInstanceId: null,
    editorialPillarId: null,
    destinations: [
      {
        id: 'd2',
        channel: 'instagram',
        placement: 'story',
        plannedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'd1',
        channel: 'facebook',
        placement: null,
        plannedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
    archivedAt: null,
    createdAt: new Date('2026-10-01T00:00:00Z'),
    updatedAt: new Date('2026-10-01T00:00:00Z'),
    ...patch,
  }) as Item;

const PHOTO: SocialContentReferenceIdentity = {
  referenceId: '60000000-0000-4000-8000-000000000001',
  mediaAssetId: '61000000-0000-4000-8000-000000000001',
  kind: 'product',
  sortOrder: 0,
};

const build = (
  brand: CreativeStudioBrandContext = BRAND,
  content: Item | null = item(),
  plannerReferences: SocialContentReferenceIdentity[] = [],
) =>
  buildGenerationContext({
    contentItemId: content ? ITEM_ID : null,
    brand,
    item: content,
    plannerReferences,
  });

function service(
  getContent: SocialPlannerService['getContent'],
  listContentReferences: SocialContentReferenceService['listContentReferences'] = async () => [
    PHOTO,
  ],
) {
  const brandContext = { load: jest.fn(async () => BRAND) };
  const planner = { getContent: jest.fn(getContent) };
  const references = { listContentReferences: jest.fn(listContentReferences) };
  return {
    brandContext,
    planner,
    references,
    service: new CreativeGenerationContextService(
      brandContext as unknown as CreativeStudioBrandContextService,
      planner as unknown as SocialPlannerService,
      references as unknown as SocialContentReferenceService,
    ),
  };
}

describe('CreativeGenerationContextService (CS3.4.1)', () => {
  it('standalone: loads the Brand Kit of the scope and never asks the Planner', async () => {
    const h = service(async () => item() as never);
    const context = await h.service.resolve(scopeA, null);

    expect(h.brandContext.load).toHaveBeenCalledWith(scopeA);
    expect(h.planner.getContent).not.toHaveBeenCalled();
    expect(h.references.listContentReferences).not.toHaveBeenCalled();
    expect(context.plannerReferences).toEqual([]);
    expect(context.content).toBeNull();
    expect(context.brand).not.toBeNull();
  });

  it('planner: reads the item through the Planner contract in the caller scope', async () => {
    const h = service(async () => item() as never);
    const context = await h.service.resolve(scopeA, ITEM_ID);

    expect(h.planner.getContent).toHaveBeenCalledWith(scopeA, ITEM_ID);
    expect(h.references.listContentReferences).toHaveBeenCalledWith(
      scopeA,
      ITEM_ID,
    );
    expect(context.plannerReferences).toEqual([
      {
        source: 'planner',
        id: PHOTO.mediaAssetId,
        kind: 'product',
        usage: 'reference',
      },
    ]);
    expect(context.contentItemId).toBe(ITEM_ID);
    expect(context.content?.brief).toBe('Café aconchegante');
    expect(context.plannerRevisionId).toBe(
      '42000000-0000-4000-8000-000000000001',
    );
  });

  it('an item the scope cannot see (other company, deleted, unknown) is a 400, indistinguishably', async () => {
    const h = service(async () => {
      throw new NotFoundException('Social content item not found.');
    });
    const error = await h.service
      .resolve(scopeA, ITEM_ID)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getResponse()).toEqual({
      code: 'content_item_not_found',
      message: 'Conteúdo não encontrado.',
    });
  });

  it('does not mask unexpected Planner failures', async () => {
    const boom = new Error('db down');
    const h = service(async () => {
      throw boom;
    });
    await expect(h.service.resolve(scopeA, ITEM_ID)).rejects.toBe(boom);
  });
});

describe('buildGenerationContext (CS3.4.1)', () => {
  it('keeps only canonical creative fields, normalized, with no ids or timestamps', () => {
    const context = build();

    expect(context.brand).toEqual({
      palette: [{ role: 'primary', hex: '#0B3D2E', label: 'Verde' }],
      typography: [{ role: 'heading', family: 'Montserrat' }],
      guidelines: 'Luz quente, sem filtros.',
    });
    expect(context.content).toEqual(
      expect.objectContaining({
        title: 'Blend de inverno',
        contentType: 'post',
        brief: 'Café aconchegante',
        channels: ['facebook', 'instagram/story'],
      }),
    );
    const facts = JSON.stringify([context.brand, context.content]);
    expect(facts).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
    expect(facts).not.toContain('2026-10-01T');
    // Hashtags, first comment and planned date are publication data, not scene.
    expect(facts).not.toContain('#cafe');
    expect(facts).not.toContain('primeiro comentário');
  });

  it('an empty Brand Kit yields no brand facts instead of invented ones', () => {
    expect(build(EMPTY, null).brand).toBeNull();
    expect(
      build(
        { ...EMPTY, palette: [{ role: 'primary', hex: '  ', label: null }] },
        null,
      ).brand,
    ).toBeNull();
  });

  it('two reference sources, kept apart: brand identities and the item own Planner references', () => {
    const context = build(BRAND, item(), [PHOTO]);
    expect(context.brandReferences.map((r) => r.kind)).toEqual([
      'logo',
      'product',
    ]);
    expect(context.brandReferences.every((r) => r.source === 'brand')).toBe(
      true,
    );
    expect(context.plannerReferences).toEqual([
      expect.objectContaining({ source: 'planner', id: PHOTO.mediaAssetId }),
    ]);
    // A Planner photo never lands in the brand set, nor the other way round.
    expect(context.brandReferences.map((r) => r.id)).not.toContain(
      PHOTO.mediaAssetId,
    );
  });

  it('a Planner reference is an identity in the digest, never text in the facts', () => {
    const context = build(BRAND, item(), [{ ...PHOTO, kind: 'person' }]);
    expect(JSON.stringify([context.brand, context.content])).not.toContain(
      PHOTO.mediaAssetId,
    );
    const record = generationContextRecord(context, 'image-prompt.v1');
    expect(record.references.planner).toEqual({
      count: 1,
      kinds: { person: 1 },
      digest: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });

  describe('digest', () => {
    const base = build().digest;

    it('is stable across reads and ignores timestamps, revision ids and ordering of the same data', () => {
      expect(build().digest).toBe(base);
      expect(
        build(
          { ...BRAND, assets: [...BRAND.assets].reverse() },
          item({
            updatedAt: new Date('2026-12-01T00:00:00Z'),
            currentRevisionId: '42000000-0000-4000-8000-000000000099',
            destinations: [...item().destinations].reverse(),
          }),
        ).digest,
      ).toBe(base);
    });

    it('a Planner reference photo swapped or re-kinded is a real context change; a label or row id is not', () => {
      const withPhoto = build(BRAND, item(), [PHOTO]).digest;
      expect(
        build(BRAND, item(), [
          { ...PHOTO, mediaAssetId: '61000000-0000-4000-8000-000000000002' },
        ]).digest,
      ).not.toBe(withPhoto);
      expect(
        build(BRAND, item(), [{ ...PHOTO, kind: 'environment' }]).digest,
      ).not.toBe(withPhoto);
      // Re-linking the same photo creates a new reference row: same context.
      expect(
        build(BRAND, item(), [
          { ...PHOTO, referenceId: '60000000-0000-4000-8000-000000000009' },
        ]).digest,
      ).toBe(withPhoto);
    });

    it.each([
      ['palette', () => build({ ...BRAND, palette: [] })],
      ['guidelines', () => build({ ...BRAND, guidelines: 'Outra regra' })],
      [
        'a brand reference added',
        () =>
          build({
            ...BRAND,
            references: [
              {
                ...BRAND.assets[0],
                id: 'r-1',
                kind: 'reference',
                usage: 'reference',
              },
            ],
          }),
      ],
      ['planner brief', () => build(BRAND, item({ brief: 'Outro' }))],
      ['planner caption', () => build(BRAND, item({ caption: 'Nova' }))],
      ['planner channel', () => build(BRAND, item({ destinations: [] }))],
      ['a planner reference added', () => build(BRAND, item(), [PHOTO])],
      ['no planner item', () => build(BRAND, null)],
    ])('changes when the %s changes', (_label, changed) => {
      expect(changed().digest).not.toBe(base);
    });
  });

  it('caps long text deterministically', () => {
    const long = 'a'.repeat(5000);
    const context = build(
      { ...BRAND, guidelines: long },
      item({ brief: long }),
    );
    expect(context.brand?.guidelines).toHaveLength(1500);
    expect(context.brand?.guidelines?.endsWith('…')).toBe(true);
    expect(context.content?.brief).toHaveLength(1200);
    expect(clip('  a \n b  ', 10)).toBe('a b');
    expect(clip('   ', 10)).toBeNull();
    expect(clip(null, 10)).toBeNull();
  });
});

describe('generationContextRecord (CS3.4.1)', () => {
  it('records versions, digests, revision and reference sets — never the text', () => {
    const context = build();
    const record = generationContextRecord(context, 'image-prompt.v1');

    expect(record).toEqual({
      version: 'generation-context.v1',
      composer: 'image-prompt.v1',
      digest: context.digest,
      brand: {
        digest: expect.stringMatching(/^[0-9a-f]{64}$/),
        applied: ['palette', 'typography', 'guidelines'],
      },
      content: {
        digest: expect.stringMatching(/^[0-9a-f]{64}$/),
        revisionId: '42000000-0000-4000-8000-000000000001',
        applied: ['title', 'contentType', 'brief', 'channels'],
      },
      references: {
        delivery: 'none',
        brand: {
          count: 2,
          kinds: { logo: 1, product: 1 },
          digest: expect.stringMatching(/^[0-9a-f]{64}$/),
        },
        planner: { count: 0, kinds: {}, digest: null },
        selected: {
          selection: 'default',
          count: 0,
          sources: {},
          kinds: {},
          digest: null,
        },
      },
    });
    const json = JSON.stringify(record);
    expect(json).not.toContain('Montserrat');
    expect(json).not.toContain('Café');
    expect(json.length).toBeLessThan(1000);
  });

  it('CS3.4.2: delivery reflects what is SELECTED, with counts and digest only', () => {
    const context = build();
    const record = generationContextRecord(context, 'image-prompt.v2', {
      selection: 'explicit',
      references: [
        { source: 'brand', kind: 'logo' },
        { source: 'planner', kind: 'product' },
        { source: 'operator', kind: 'product' },
      ],
      digest: 'd'.repeat(64),
    });
    expect(record.references.delivery).toBe('provider_reference_images');
    expect(record.references.selected).toEqual({
      selection: 'explicit',
      count: 3,
      sources: { brand: 1, planner: 1, operator: 1 },
      kinds: { logo: 1, product: 2 },
      digest: 'd'.repeat(64),
    });
    // Available stays what the owners offered, independent of the selection.
    expect(record.references.brand.count).toBe(2);
    expect(JSON.stringify(record).length).toBeLessThan(1200);
  });
});

describe('Planner references keep the Planner order (CS3.4.2)', () => {
  const ref = (mediaAssetId: string, sortOrder: number) => ({
    referenceId: `r-${sortOrder}`,
    mediaAssetId,
    kind: 'product',
    sortOrder,
  });
  // Planner order is the REVERSE of id order on purpose.
  const planner = [
    ref('ffffffff-0000-4000-8000-000000000001', 0),
    ref('00000000-0000-4000-8000-000000000002', 1),
  ];

  it('exposes them in sort_order (the default selection sends them so), whatever the read order', () => {
    const forward = build(BRAND, item(), planner);
    const shuffled = build(BRAND, item(), [...planner].reverse());
    expect(forward.plannerReferences.map((r) => r.id)).toEqual([
      'ffffffff-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002',
    ]);
    expect(shuffled.plannerReferences).toEqual(forward.plannerReferences);
    expect(shuffled.digest).toBe(forward.digest);
  });
});
