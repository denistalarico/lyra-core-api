import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import {
  MAX_SOCIAL_CONTENT_REFERENCES,
  SOCIAL_CONTENT_REFERENCE_KINDS,
  type SocialContentReferenceKind,
} from '../entities/social-content-reference.entity';

/**
 * Links an existing durable image of the caller's scope. A new image is first
 * uploaded through `POST /social/publishing/media` (`source=planner_reference`)
 * and then linked here: the binary is stored once and never copied.
 */
export class LinkSocialContentReferenceDto {
  @IsUUID() mediaAssetId!: string;
  @IsIn(SOCIAL_CONTENT_REFERENCE_KINDS) kind!: SocialContentReferenceKind;
  @IsOptional() @IsString() @MaxLength(240) label?: string | null;
}

/** `label: null` clears it; an omitted field is left unchanged. */
export class UpdateSocialContentReferenceDto {
  @IsOptional()
  @IsIn(SOCIAL_CONTENT_REFERENCE_KINDS)
  kind?: SocialContentReferenceKind;
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(240)
  label?: string | null;
}

export class ReorderSocialContentReferencesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_SOCIAL_CONTENT_REFERENCES)
  @IsUUID('all', { each: true })
  referenceIds!: string[];
}
