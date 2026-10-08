import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import { In, Repository } from 'typeorm';
import {
  durableMediaAssetSource,
  MediaAssetEntity,
  mediaAssetScopeWhere,
} from '../../common/media-assets';
import { SocialBrandKitContextPort } from '../brand-kit/services/social-brand-kit-context.port';
import {
  SOCIAL_CONTENT_REFERENCE_KINDS,
  type SocialContentReferenceKind,
} from '../social-planner/entities';
import type { ResolvedCreativeGenerationContext } from './creative-generation-context';
import {
  IMAGE_GENERATION_REFERENCE_MIME_TYPES,
  type ImageGenerationReferenceRole,
  MAX_IMAGE_GENERATION_REFERENCE_BYTES,
  MAX_IMAGE_GENERATION_REFERENCE_TOTAL_BYTES,
  MAX_IMAGE_GENERATION_REFERENCES,
} from './creative-image-generation.provider';
import type { CreativeStudioScope } from './creative-studio.scope';

/**
 * CS3.4.2 — Reference Images.
 *
 * Four stages, kept apart (blueprint §10.5):
 *
 *   available  what the owners offer in the caller's scope: Brand Kit assets
 *              and the Planner item's Visual References (Generation Context,
 *              identities + digests only);
 *   selected   the ordered subset this generation uses — the operator's
 *              explicit `references`, or the deterministic default below;
 *   persisted  the selection frozen at enqueue in
 *              `social_creative_generation_references`, with a checksum
 *              snapshot of each binary. The worker reads ONLY these rows,
 *              never the current Planner or Brand Kit;
 *   dispatch   rows stamped `dispatch_started_at` when the worker, under a
 *              valid lease and with their bytes verified, STARTS a provider
 *              attempt. An attempt started, not a delivery confirmed: the
 *              process may die before the request leaves, and nothing here
 *              says the provider received, billed or answered.
 *
 * Sources keep their owner: `brand` = Brand Kit asset (`brand_kit_assets`),
 * `planner` = a media linked to the request's content item, `operator` = any
 * durable image of the same scope the operator picks explicitly (media
 * library, a promoted Creative Version) — no new upload path.
 */
export const CREATIVE_GENERATION_REFERENCE_SOURCES = [
  'brand',
  'planner',
  'operator',
] as const;
export type CreativeGenerationReferenceSource =
  (typeof CREATIVE_GENERATION_REFERENCE_SOURCES)[number];

/**
 * CS3.6.2 — what a frozen reference row may hold: the selectable sources plus
 * `base`, a variation's Image 1. `base` is never selectable (the DTO only
 * admits the three above): the service resolves it from the variation's
 * origin — an output or a Creative Version the caller can see — and never
 * from an id the client chose as "a reference".
 */
export type CreativeGenerationPersistedReferenceSource =
  | CreativeGenerationReferenceSource
  | 'base';

/** Operator media has no kind of its own: the operator states it (Planner vocabulary). */
export const OPERATOR_REFERENCE_KINDS = SOCIAL_CONTENT_REFERENCE_KINDS;

/** One explicit choice. `id` is always the binary's owner row id. */
export type CreativeGenerationReferenceSelection = {
  source: CreativeGenerationReferenceSource;
  /** brand: Brand Kit asset id; planner/operator: media asset id. */
  id: string;
  /** Required for `operator`, refused for the others (owners decide those). */
  kind?: SocialContentReferenceKind;
};

/** A reference as frozen at enqueue — the row's content, before ids/time. */
export type SelectedCreativeGenerationReference = {
  source: CreativeGenerationPersistedReferenceSource;
  assetId: string;
  kind: string;
  role: ImageGenerationReferenceRole;
  mimeType: string;
  byteSize: number;
  checksum: string;
};

export type CreativeGenerationReferencePlan = {
  selection: 'default' | 'explicit';
  references: SelectedCreativeGenerationReference[];
  /** sha256 over the ordered identities (source, id, kind, checksum); NULL when empty. */
  digest: string | null;
};

/**
 * What each kind is FOR. Kinds come from two vocabularies (Brand Kit and
 * Planner); a kind neither knows (a future addition) is treated as a plain
 * reference with no assumed role, never as something to preserve.
 */
const KIND_ROLES: Record<string, ImageGenerationReferenceRole> = {
  product: 'subject',
  packaging: 'subject',
  person: 'subject',
  property: 'subject',
  vehicle: 'subject',
  apparel: 'subject',
  logo: 'logo',
  environment: 'context',
  background: 'context',
  style: 'style',
  reference: 'style',
  texture: 'style',
  graphic_element: 'style',
  photo: 'general',
  client_provided: 'general',
};

export function referenceRole(kind: string): ImageGenerationReferenceRole {
  return Object.hasOwn(KIND_ROLES, kind) ? KIND_ROLES[kind] : 'general';
}

/**
 * Default selection (no `references` in the request), deterministic:
 *
 *   - the content item's Planner references, in the Planner's own order —
 *     they were attached to THIS content to be used for it;
 *   - no Brand Kit asset. The Brand Kit is a library (several logo variants,
 *     photos, style references); which of them a given creative needs, and
 *     whether the logo should appear at all, is the operator's call (§19).
 *     Brand identity still reaches every generation as text (palette,
 *     typography, guidelines).
 *
 * Never truncated: more Planner references than the technical limit, or one
 * the provider cannot take, is a 400 asking for an explicit selection.
 */
@Injectable()
export class CreativeGenerationReferenceSelector {
  constructor(
    private readonly brandKit: SocialBrandKitContextPort,
    @InjectRepository(MediaAssetEntity, 'agency')
    private readonly media: Repository<MediaAssetEntity>,
  ) {}

  /**
   * CS3.6.2 — `base`, when given, is a variation's Image 1, already resolved
   * and checked by the service. It is prepended, counts toward the limit
   * (six images in total, base included) and may not also be chosen as an
   * ordinary reference.
   */
  async select(
    scope: CreativeStudioScope,
    context: ResolvedCreativeGenerationContext,
    explicit: readonly CreativeGenerationReferenceSelection[] | undefined,
    base?: SelectedCreativeGenerationReference,
  ): Promise<CreativeGenerationReferencePlan> {
    const selection = explicit === undefined ? 'default' : 'explicit';
    const choices: CreativeGenerationReferenceSelection[] =
      explicit === undefined
        ? context.plannerReferences.map((ref) => ({
            source: 'planner',
            id: ref.id,
          }))
        : explicit.map((choice) => ({ ...choice }));

    const limit = MAX_IMAGE_GENERATION_REFERENCES - (base ? 1 : 0);
    if (choices.length > limit)
      throw refusal(
        selection === 'default'
          ? 'reference_selection_required'
          : 'reference_limit_exceeded',
        selection === 'default'
          ? `O conteúdo tem mais de ${limit} referências; escolha quais usar.`
          : base
            ? `Escolha até ${limit} referências além da imagem base.`
            : `Escolha até ${limit} referências por geração.`,
      );
    for (const choice of choices) assertChoiceShape(choice);
    // Postgres answers uuids in lower case; compare and freeze them that way.
    for (const choice of choices) choice.id = choice.id.toLowerCase();
    const baseId = base?.assetId.toLowerCase();
    if (
      new Set([...choices.map((c) => c.id), ...(baseId ? [baseId] : [])])
        .size !==
      choices.length + (baseId ? 1 : 0)
    )
      throw refusal(
        'reference_duplicated',
        'A mesma imagem foi escolhida mais de uma vez.',
      );

    const plannerKinds = new Map(
      context.plannerReferences.map((ref) => [ref.id, ref.kind]),
    );
    const brandIds = choices
      .filter((c) => c.source === 'brand')
      .map((c) => c.id);
    const mediaIds = choices
      .filter((c) => c.source !== 'brand')
      .map((c) => c.id);
    const [brandRows, mediaRows] = await Promise.all([
      this.brandKit.resolveAssets(scope, brandIds),
      mediaIds.length
        ? this.media.find({
            where: {
              id: In(mediaIds),
              ...mediaAssetScopeWhere(scope),
              // Temporary generation outputs are never a direct reference
              // (§11): promote first. Tombstones are excluded by TypeORM.
              source: durableMediaAssetSource(),
            },
          })
        : Promise.resolve<MediaAssetEntity[]>([]),
    ]);
    const brandById = new Map(brandRows.map((row) => [row.id, row]));
    const mediaById = new Map(mediaRows.map((row) => [row.id, row]));

    const chosen = choices.map((choice) => {
      let kind: string | undefined;
      let binary:
        | { mimeType: string; byteSize: string; checksum: string | null }
        | undefined;
      if (choice.source === 'brand') {
        binary = brandById.get(choice.id);
        kind = brandById.get(choice.id)?.kind;
      } else {
        // A Planner choice must be one of THIS item's references: knowing a
        // media id is not enough to call it "the content's reference".
        kind =
          choice.source === 'planner'
            ? plannerKinds.get(choice.id)
            : choice.kind;
        binary = kind ? mediaById.get(choice.id) : undefined;
      }
      // Missing, other company, temporary, deleted, not in this item, no
      // checksum to freeze: one indistinguishable answer.
      if (!binary || !kind || !binary.checksum)
        throw refusal(
          'reference_not_found',
          'Imagem de referência não encontrada.',
        );
      if (
        !(IMAGE_GENERATION_REFERENCE_MIME_TYPES as readonly string[]).includes(
          binary.mimeType,
        )
      )
        throw refusal(
          'reference_format_unsupported',
          'Use imagens PNG, JPEG ou WebP como referência.',
        );
      const byteSize = Number(binary.byteSize);
      if (
        !Number.isSafeInteger(byteSize) ||
        byteSize <= 0 ||
        byteSize > MAX_IMAGE_GENERATION_REFERENCE_BYTES
      )
        throw refusal(
          'reference_too_large',
          `Cada referência pode ter até ${MAX_IMAGE_GENERATION_REFERENCE_BYTES / 1024 / 1024} MB.`,
        );
      return {
        source: choice.source,
        assetId: choice.id,
        kind,
        role: referenceRole(kind),
        mimeType: binary.mimeType,
        byteSize,
        checksum: binary.checksum,
      };
    });

    const references: SelectedCreativeGenerationReference[] = [
      ...(base ? [{ ...base, assetId: base.assetId.toLowerCase() }] : []),
      ...chosen,
    ];
    if (
      references.reduce((sum, ref) => sum + ref.byteSize, 0) >
      MAX_IMAGE_GENERATION_REFERENCE_TOTAL_BYTES
    )
      throw refusal(
        'reference_too_large',
        `As referências somadas podem ter até ${MAX_IMAGE_GENERATION_REFERENCE_TOTAL_BYTES / 1024 / 1024} MB.`,
      );

    return { selection, references, digest: referencesDigest(references) };
  }
}

/**
 * Order is part of the identity: the prompt names images by position and the
 * provider weighs them in order, so [A, B] and [B, A] are different requests.
 * The checksum makes "same id, other bytes" a different request too.
 */
export function referencesDigest(
  references: readonly Pick<
    SelectedCreativeGenerationReference,
    'source' | 'assetId' | 'kind' | 'checksum'
  >[],
  // The base (CS3.6.2) is part of this digest like any reference: its source
  // `base`, position 0 and checksum make "same base, other bytes" and "same
  // image as base vs. as reference" different requests.
): string | null {
  if (!references.length) return null;
  return createHash('sha256')
    .update(
      JSON.stringify(
        references.map((ref) => [
          ref.source,
          ref.assetId.toLowerCase(),
          ref.kind,
          ref.checksum,
        ]),
      ),
    )
    .digest('hex');
}

/** Callers outside HTTP skip the DTO; shape is re-checked here. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertChoiceShape(choice: CreativeGenerationReferenceSelection) {
  if (
    !CREATIVE_GENERATION_REFERENCE_SOURCES.includes(choice?.source) ||
    typeof choice.id !== 'string' ||
    !UUID.test(choice.id)
  )
    throw refusal(
      'reference_not_found',
      'Imagem de referência não encontrada.',
    );
  if (choice.source === 'operator') {
    if (
      !choice.kind ||
      !(OPERATOR_REFERENCE_KINDS as readonly string[]).includes(choice.kind)
    )
      throw refusal(
        'reference_kind_required',
        'Informe o tipo da imagem de referência escolhida.',
      );
  } else if (choice.kind !== undefined) {
    // Brand Kit and Planner own the kind of their references.
    throw refusal(
      'reference_kind_not_allowed',
      'O tipo desta referência vem da origem e não pode ser alterado aqui.',
    );
  }
}

function refusal(code: string, message: string) {
  return new BadRequestException({ code, message });
}
