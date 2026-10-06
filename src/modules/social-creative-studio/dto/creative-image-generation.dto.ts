import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  CREATIVE_IMAGE_ASPECT_RATIOS,
  CREATIVE_IMAGE_QUALITIES,
  type CreativeImageAspectRatio,
  type CreativeImageQuality,
  MAX_IMAGE_GENERATION_OUTPUTS,
} from '../creative-image-generation.provider';

/**
 * CS3.1 — Lyra vocabulary only. No provider, model or vendor option is
 * accepted, and no tenant/client/company id: scope comes from the request
 * context.
 */
export class GenerateCreativeImageDto {
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
