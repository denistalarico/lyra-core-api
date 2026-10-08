import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  CREATIVE_GENERATION_REFERENCE_SOURCES,
  type CreativeGenerationReferenceSource,
  OPERATOR_REFERENCE_KINDS,
} from '../creative-generation-references';
import {
  CREATIVE_IMAGE_ASPECT_RATIOS,
  CREATIVE_IMAGE_QUALITIES,
  type CreativeImageAspectRatio,
  type CreativeImageQuality,
  MAX_IMAGE_GENERATION_OUTPUTS,
  MAX_IMAGE_GENERATION_REFERENCES,
} from '../creative-image-generation.provider';
import type { SocialContentReferenceKind } from '../../social-planner/entities';

/**
 * CS3.4.2 — one explicitly selected reference. Only owner ids of the SAME
 * scope are accepted; never a storage key, URL or bytes (no upload here: new
 * images go through the existing media/Brand Kit uploads first).
 *   - `brand`:    a Brand Kit asset id; its kind comes from the Brand Kit;
 *   - `planner`:  a media asset id linked to `contentItemId` in the Planner;
 *                 its kind comes from the Planner;
 *   - `operator`: any durable image of the scope (media asset id), with the
 *                 `kind` the operator declares.
 */
export class GenerationReferenceSelectionDto {
  @IsIn(CREATIVE_GENERATION_REFERENCE_SOURCES)
  source!: CreativeGenerationReferenceSource;
  @IsUUID() id!: string;
  @IsOptional()
  @IsIn(OPERATOR_REFERENCE_KINDS)
  kind?: SocialContentReferenceKind;
}

/**
 * CS3.1 — Lyra vocabulary only. No provider, model or vendor option is
 * accepted, and no tenant/client/company id: scope comes from the request
 * context.
 */
export class GenerateCreativeImageDto {
  @IsString() @MinLength(1) @MaxLength(4000) prompt!: string;
  /**
   * CS3.4.1 — optional Planner content item. Only the reference: its content
   * is resolved server-side in the caller's scope, never sent by the client.
   */
  @IsOptional() @IsUUID() contentItemId?: string;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_IMAGE_GENERATION_OUTPUTS)
  outputCount?: number;
  @IsOptional()
  @IsIn(CREATIVE_IMAGE_ASPECT_RATIOS)
  aspectRatio?: CreativeImageAspectRatio;
  @IsOptional() @IsIn(CREATIVE_IMAGE_QUALITIES) quality?: CreativeImageQuality;
  /**
   * CS3.4.2 — ordered ("Image 1..N"). Omitted: the item's Planner references
   * in Planner order; `[]`: none.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_IMAGE_GENERATION_REFERENCES)
  @ValidateNested({ each: true })
  @Type(() => GenerationReferenceSelectionDto)
  references?: GenerationReferenceSelectionDto[];
}
export class PromoteGeneratedOutputDto {
  @IsOptional() @IsString() @MaxLength(255) name?: string;
  @IsOptional() @IsUUID() folderId?: string;
  @IsOptional() @IsUUID() contentItemId?: string;
}
export class PromoteGeneratedOutputAsVersionDto {
  @IsUUID() assetId!: string;
  /** Same meaning as `CreateCreativeVersionDto.revisesVersionId` (CS2B.6). */
  @IsOptional() @IsUUID() revisesVersionId?: string;
}

/**
 * CS3.6.2 — "Gerar novamente". Only overrides of the origin's intent: no
 * Planner item, scope, provider, model, checksum, effective prompt or storage
 * path. Everything omitted comes from the origin generation.
 */
export class RegenerateCreativeImageDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(4000) prompt?: string;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_IMAGE_GENERATION_OUTPUTS)
  outputCount?: number;
  @IsOptional()
  @IsIn(CREATIVE_IMAGE_ASPECT_RATIOS)
  aspectRatio?: CreativeImageAspectRatio;
  @IsOptional() @IsIn(CREATIVE_IMAGE_QUALITIES) quality?: CreativeImageQuality;
  /** Replaces the origin's ordinary references; a variation's base stays. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_IMAGE_GENERATION_REFERENCES)
  @ValidateNested({ each: true })
  @Type(() => GenerationReferenceSelectionDto)
  references?: GenerationReferenceSelectionDto[];
}

/**
 * CS3.6.2 — "Criar variação". `prompt` is what to change; the base comes
 * from the route. `references` are additional images (base + up to five).
 */
export class VaryCreativeImageDto {
  @IsString() @MinLength(1) @MaxLength(4000) prompt!: string;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_IMAGE_GENERATION_OUTPUTS)
  outputCount?: number;
  @IsOptional()
  @IsIn(CREATIVE_IMAGE_ASPECT_RATIOS)
  aspectRatio?: CreativeImageAspectRatio;
  @IsOptional() @IsIn(CREATIVE_IMAGE_QUALITIES) quality?: CreativeImageQuality;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_IMAGE_GENERATION_REFERENCES - 1)
  @ValidateNested({ each: true })
  @Type(() => GenerationReferenceSelectionDto)
  references?: GenerationReferenceSelectionDto[];
}
