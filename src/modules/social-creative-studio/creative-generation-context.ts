import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  type SocialContentReferenceIdentity,
  SocialContentReferenceService,
} from '../social-planner/services/social-content-reference.service';
import { SocialPlannerService } from '../social-planner/services/social-planner.service';
import {
  type CreativeStudioBrandContext,
  CreativeStudioBrandContextService,
} from './creative-brand-context.service';
import type { CreativeStudioScope } from './creative-studio.scope';

/**
 * CS3.4.1 — Generation Context.
 *
 * Three things a generation keeps apart (blueprint §11.7):
 *
 *   user intent       what the operator typed (`prompt`), never rewritten;
 *   resolved context  facts the SERVER resolves from the owners — Brand Kit
 *                     (Social Settings) and, optionally, a Planner content
 *                     item — under the caller's full scope;
 *   effective prompt  the text the provider receives, composed from both by
 *                     `composeCreativeImagePrompt`.
 *
 * The facts below are the only shape context takes inside the Studio: plain,
 * already-normalized creative text. They never carry an id, a timestamp, a
 * storage path or a scope part, so nothing internal can reach a provider
 * through them and their digest only moves when the creative content does.
 *
 * Nothing here is persisted as a copy. The generation stores the effective
 * prompt plus a `CreativeGenerationContextRecord` (references and digests),
 * so Brand Kit and Planner stay the owners of their data.
 */
export const CREATIVE_GENERATION_CONTEXT_VERSION = 'generation-context.v1';

/**
 * Caps per field (characters, after whitespace normalization). The Planner's
 * text fields have no length limit of their own and Brand Kit guidelines go
 * up to 8000: the composer briefs, it does not paste documents. Worst case of
 * all sections plus the 4000-character request stays far below the 32000 the
 * `effective_prompt` CHECK allows.
 */
const LIMITS = {
  paletteEntries: 12,
  typographyEntries: 6,
  shortText: 120,
  guidelines: 1500,
  title: 240,
  theme: 400,
  keyMessage: 400,
  brief: 1200,
  copy: 1000,
  caption: 800,
  script: 1500,
  cta: 200,
  channels: 8,
} as const;

export type CreativeGenerationBrandFacts = {
  palette: { role: string; hex: string; label: string | null }[];
  typography: { role: string; family: string }[];
  guidelines: string | null;
};

/** Planner fields that exist on a content item today, nothing invented. */
export type CreativeGenerationContentFacts = {
  title: string;
  contentType: string | null;
  creativeFormat: string | null;
  objective: string | null;
  funnelStage: string | null;
  theme: string | null;
  keyMessage: string | null;
  brief: string | null;
  copy: string | null;
  caption: string | null;
  script: string | null;
  cta: string | null;
  /** `channel` or `channel/placement` of the item's destinations, sorted. */
  channels: string[];
};

/**
 * Identity of a visual reference available to the generation. Two sources
 * with distinct owners (blueprint §10.4):
 *   - `brand`: permanent, reusable brand assets/references (Brand Kit);
 *   - `planner`: references specific to one content item, owned by the
 *     Planner (`social_content_references`, read through
 *     `SocialContentReferenceService.listContentReferences`). Identity is the
 *     linked media + kind: swapping the photo or its kind changes the digest.
 * These are the AVAILABLE references; which of them a generation actually
 * sends is its selection (`creative-generation-references.ts`, CS3.4.2).
 */
export type CreativeGenerationReferenceIdentity = {
  source: 'brand' | 'planner';
  id: string;
  kind: string;
  usage: string;
};

export type ResolvedCreativeGenerationContext = {
  contentItemId: string | null;
  brand: CreativeGenerationBrandFacts | null;
  content: CreativeGenerationContentFacts | null;
  brandReferences: CreativeGenerationReferenceIdentity[];
  /**
   * In the Planner's own order (`sort_order`): CS3.4.2's default selection
   * sends them in that order. Digests sort, so reading order never moves them.
   */
  plannerReferences: CreativeGenerationReferenceIdentity[];
  /** Planner revision behind copy/caption/script/CTA; NULL when never revised. */
  plannerRevisionId: string | null;
  /** sha256 over facts + reference identities; enters the request fingerprint. */
  digest: string;
};

type ReferenceSetRecord = {
  count: number;
  kinds: Record<string, number>;
  digest: string | null;
};

/** What `social_creative_generations.generation_context` holds. No text. */
export type CreativeGenerationContextRecord = {
  version: typeof CREATIVE_GENERATION_CONTEXT_VERSION;
  composer: string;
  digest: string;
  brand: { digest: string; applied: string[] } | null;
  content: {
    digest: string;
    revisionId: string | null;
    applied: string[];
  } | null;
  references: {
    /**
     * `none`: text-only generation. `provider_reference_images` (CS3.4.2):
     * the selected images travel to the provider as bytes, frozen in
     * `social_creative_generation_references`.
     */
    delivery: 'none' | 'provider_reference_images';
    /** Available, per owner. */
    brand: ReferenceSetRecord;
    planner: ReferenceSetRecord;
    /** Selected and persisted (CS3.4.2); absent on rows created before it. */
    selected?: {
      selection: 'default' | 'explicit';
      count: number;
      sources: Record<string, number>;
      kinds: Record<string, number>;
      digest: string | null;
    };
  };
};

/** Just what the record needs from a selection — no ids, no checksums. */
export type GenerationContextSelection = {
  selection: 'default' | 'explicit';
  references: readonly { source: string; kind: string }[];
  digest: string | null;
};

type PlannerContentView = Awaited<
  ReturnType<SocialPlannerService['getContent']>
>;

/**
 * Resolves the Generation Context through the owners' public contracts only:
 * `CreativeStudioBrandContextService` (over `SocialBrandKitContextPort`),
 * `SocialPlannerService.getContent` and
 * `SocialContentReferenceService.listContentReferences` — both prove the
 * item, its parent plan's Company Context and that neither is soft-deleted.
 * A known id from another company resolves to nothing.
 */
@Injectable()
export class CreativeGenerationContextService {
  constructor(
    private readonly brandContext: CreativeStudioBrandContextService,
    private readonly planner: SocialPlannerService,
    private readonly plannerReferences: SocialContentReferenceService,
  ) {}

  async resolve(
    scope: CreativeStudioScope,
    contentItemId: string | null,
  ): Promise<ResolvedCreativeGenerationContext> {
    const [brand, planner] = await Promise.all([
      this.brandContext.load(scope),
      contentItemId ? this.plannerContent(scope, contentItemId) : null,
    ]);
    return buildGenerationContext({
      contentItemId,
      brand,
      item: planner?.item ?? null,
      plannerReferences: planner?.references ?? [],
    });
  }

  private async plannerContent(scope: CreativeStudioScope, id: string) {
    try {
      const [item, references] = await Promise.all([
        this.planner.getContent(scope, id),
        this.plannerReferences.listContentReferences(scope, id),
      ]);
      return { item, references };
    } catch (error) {
      // Same answer as the Studio's own content link: absent, deleted and
      // other-company are indistinguishable.
      if (error instanceof NotFoundException)
        throw new BadRequestException({
          code: 'content_item_not_found',
          message: 'Conteúdo não encontrado.',
        });
      throw error;
    }
  }
}

/** Pure: owner projections → normalized facts, reference identities, digest. */
export function buildGenerationContext(input: {
  contentItemId: string | null;
  brand: CreativeStudioBrandContext;
  item: PlannerContentView | null;
  plannerReferences?: readonly SocialContentReferenceIdentity[];
}): ResolvedCreativeGenerationContext {
  const brand = brandFacts(input.brand);
  const content = input.item ? contentFacts(input.item) : null;
  const brandReferences = sortIdentities(
    [...input.brand.assets, ...input.brand.references].map((asset) => ({
      source: 'brand' as const,
      id: asset.id,
      kind: asset.kind,
      usage: asset.usage,
    })),
  );
  const plannerReferences = [...(input.plannerReferences ?? [])]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((ref) => ({
      source: 'planner' as const,
      id: ref.mediaAssetId,
      kind: ref.kind,
      usage: 'reference',
    }));
  return {
    contentItemId: input.contentItemId,
    brand,
    content,
    brandReferences,
    plannerReferences,
    plannerRevisionId: input.item?.currentRevisionId ?? null,
    digest: sha256([
      CREATIVE_GENERATION_CONTEXT_VERSION,
      brand,
      content,
      brandReferences.map(identityKey),
      sortIdentities(plannerReferences).map(identityKey),
    ]),
  };
}

/** The persisted record: references and digests, never the facts' text. */
export function generationContextRecord(
  context: ResolvedCreativeGenerationContext,
  composer: string,
  selected: GenerationContextSelection = {
    selection: 'default',
    references: [],
    digest: null,
  },
): CreativeGenerationContextRecord {
  const count = (key: 'source' | 'kind') => {
    const counts: Record<string, number> = {};
    for (const ref of selected.references)
      counts[ref[key]] = (counts[ref[key]] ?? 0) + 1;
    return counts;
  };
  return {
    version: CREATIVE_GENERATION_CONTEXT_VERSION,
    composer,
    digest: context.digest,
    brand: context.brand
      ? { digest: sha256(context.brand), applied: applied(context.brand) }
      : null,
    content: context.content
      ? {
          digest: sha256(context.content),
          revisionId: context.plannerRevisionId,
          applied: applied(context.content),
        }
      : null,
    references: {
      delivery: selected.references.length
        ? 'provider_reference_images'
        : 'none',
      brand: referenceSet(context.brandReferences),
      planner: referenceSet(context.plannerReferences),
      selected: {
        selection: selected.selection,
        count: selected.references.length,
        sources: count('source'),
        kinds: count('kind'),
        digest: selected.digest,
      },
    },
  };
}

function brandFacts(
  brand: CreativeStudioBrandContext,
): CreativeGenerationBrandFacts | null {
  const palette = brand.palette
    .flatMap((entry) => {
      const hex = clip(entry.hex, 16);
      if (!hex) return [];
      return [
        {
          role: clip(entry.role, LIMITS.shortText) ?? '',
          hex,
          label: clip(entry.label, LIMITS.shortText),
        },
      ];
    })
    .slice(0, LIMITS.paletteEntries);
  const typography = brand.typography
    .flatMap((entry) => {
      const family = clip(entry.family, LIMITS.shortText);
      if (!family) return [];
      return [{ role: clip(entry.role, LIMITS.shortText) ?? '', family }];
    })
    .slice(0, LIMITS.typographyEntries);
  const guidelines = clip(brand.guidelines, LIMITS.guidelines);
  if (!palette.length && !typography.length && !guidelines) return null;
  return { palette, typography, guidelines };
}

function contentFacts(
  item: PlannerContentView,
): CreativeGenerationContentFacts {
  const channels = [
    ...new Set(
      item.destinations
        .map((d) =>
          [clip(d.channel, 40), clip(d.placement, 40)]
            .filter(Boolean)
            .join('/'),
        )
        .filter(Boolean),
    ),
  ]
    .sort()
    .slice(0, LIMITS.channels);
  return {
    title: clip(item.title, LIMITS.title) ?? '',
    contentType: clip(item.contentType, LIMITS.shortText),
    creativeFormat: clip(item.creativeFormat, LIMITS.shortText),
    objective: clip(item.objective, LIMITS.shortText),
    funnelStage: clip(item.funnelStage, LIMITS.shortText),
    theme: clip(item.theme, LIMITS.theme),
    keyMessage: clip(item.keyMessage, LIMITS.keyMessage),
    brief: clip(item.brief, LIMITS.brief),
    copy: clip(item.copy, LIMITS.copy),
    caption: clip(item.caption, LIMITS.caption),
    script: clip(item.script, LIMITS.script),
    cta: clip(item.cta, LIMITS.cta),
    channels,
  };
}

/**
 * Whitespace collapsed to single spaces, then capped with an ellipsis. Pure
 * and deterministic, so the same stored text always yields the same facts.
 */
export function clip(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

function sortIdentities(list: CreativeGenerationReferenceIdentity[]) {
  return [...list].sort((a, b) => identityKey(a).localeCompare(identityKey(b)));
}

function identityKey(ref: CreativeGenerationReferenceIdentity) {
  return `${ref.source}:${ref.id}:${ref.kind}:${ref.usage}`;
}

function referenceSet(
  list: CreativeGenerationReferenceIdentity[],
): ReferenceSetRecord {
  const kinds: Record<string, number> = {};
  for (const ref of list) kinds[ref.kind] = (kinds[ref.kind] ?? 0) + 1;
  return {
    count: list.length,
    kinds,
    digest: list.length ? sha256(sortIdentities(list).map(identityKey)) : null,
  };
}

/** Names of the fields that carried something — for audits, not for text. */
function applied(facts: object): string[] {
  return Object.entries(facts)
    .filter(([, value]) =>
      Array.isArray(value) ? value.length > 0 : value !== null && value !== '',
    )
    .map(([key]) => key);
}

function sha256(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
