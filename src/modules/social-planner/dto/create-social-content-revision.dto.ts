import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import type { SocialContentRevisionSource } from '../entities';

export class CreateSocialContentRevisionDto {
  @IsOptional()
  @IsString()
  copy?: string | null;

  @IsOptional()
  @IsString()
  caption?: string | null;

  @IsOptional()
  @IsString()
  script?: string | null;

  @IsOptional()
  @IsString()
  cta?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  hashtags?: string[];

  @IsOptional()
  @IsString()
  firstComment?: string | null;

  @IsOptional()
  @IsIn([
    'human',
    'ai',
    'ai_then_human',
    'human_then_ai',
    'import',
  ] satisfies SocialContentRevisionSource[])
  source?: SocialContentRevisionSource;

  /**
   * Reserved for the shared Intelligence Layer.
   * The Planner stores only the reference and never provider/model details.
   */
  @IsOptional()
  @IsUUID()
  generationRunId?: string | null;
}
