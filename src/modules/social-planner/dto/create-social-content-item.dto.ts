import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import type { SocialContentPlanningStatus } from '../entities';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class CreateSocialContentItemDto {
  @IsString()
  @MaxLength(240)
  title!: string;

  @IsOptional()
  @IsString()
  theme?: string | null;

  @IsOptional()
  @IsString()
  brief?: string | null;

  @IsOptional()
  @IsString()
  keyMessage?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  funnelStage?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  contentType?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  objective?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  creativeFormat?: string | null;

  @IsOptional()
  @IsIn([
    'idea',
    'planned',
    'copy_in_progress',
    'copy_ready',
    'creative_in_progress',
    'creative_ready',
    'ready',
  ] satisfies SocialContentPlanningStatus[])
  planningStatus?: SocialContentPlanningStatus;

  @IsOptional()
  @Matches(ISO_DATE)
  plannedDate?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  /** Both are validated against the caller's own scope by the service. */
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsUUID()
  campaignInstanceId?: string | null;

  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsUUID()
  editorialPillarId?: string | null;
}
