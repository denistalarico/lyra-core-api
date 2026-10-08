import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  CREATIVE_VIDEO_MODES,
  CREATIVE_VIDEO_QUALITIES,
  type CreativeVideoMode,
  type CreativeVideoQuality,
  MAX_VIDEO_DURATION_SECONDS,
  MIN_VIDEO_DURATION_SECONDS,
} from '../creative-video-generation.provider';
import { GenerationReferenceSelectionDto } from './creative-image-generation.dto';

/**
 * CS4-B — Lyra vocabulary only. The global ValidationPipe
 * (`forbidNonWhitelisted`) refuses anything else: no provider, model,
 * resolution, engine, scope/company id, storage URL, cost or effective
 * prompt can be sent. Mode-specific rules (which fields belong to which
 * mode) are enforced by the service, so non-HTTP callers get them too.
 */
export class GenerateCreativeVideoDto {
  @IsIn(CREATIVE_VIDEO_MODES) mode!: CreativeVideoMode;

  /** generative_reel: what the Reel should show. */
  @IsOptional() @IsString() @MinLength(1) @MaxLength(4000) prompt?: string;
  /** ugc_avatar: explicit words to speak (omitted = the Planner item's script). */
  @IsOptional() @IsString() @MinLength(1) @MaxLength(4000) script?: string;
  @IsOptional() @IsUUID() contentItemId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(MIN_VIDEO_DURATION_SECONDS)
  @Max(MAX_VIDEO_DURATION_SECONDS)
  durationSeconds?: number;
  @IsOptional() @IsIn(CREATIVE_VIDEO_QUALITIES) quality?: CreativeVideoQuality;
  @IsOptional() @IsBoolean() audio?: boolean;

  /** generative_reel: the image to animate (vertical 9:16). */
  @IsOptional()
  @ValidateNested()
  @Type(() => GenerationReferenceSelectionDto)
  startFrame?: GenerationReferenceSelectionDto;
  /** generative_reel: subjects to keep consistent. */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(6)
  @ValidateNested({ each: true })
  @Type(() => GenerationReferenceSelectionDto)
  references?: GenerationReferenceSelectionDto[];

  /** ugc_avatar: a Lyra avatar id from `GET video-avatars`. */
  @IsOptional() @IsUUID() avatarId?: string;
  @IsOptional()
  @IsString()
  @MaxLength(16)
  @Matches(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/)
  language?: string;
  /** ugc_avatar: optional product image behind the avatar. */
  @IsOptional()
  @ValidateNested()
  @Type(() => GenerationReferenceSelectionDto)
  productImage?: GenerationReferenceSelectionDto;
}
