import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class CreateSocialContentIdeaDto {
  @IsString()
  @MaxLength(240)
  title!: string;

  @IsOptional()
  @IsString()
  notes?: string | null;

  @IsOptional()
  @IsUUID()
  pillarId?: string | null;

  @IsOptional()
  @IsUUID()
  campaignInstanceId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  funnelStage?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  contentType?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  source?: string;
}

/**
 * Status is not updatable here.
 *
 * `converted` is set only by the conversion endpoint, which writes the target
 * content id in the same transaction — the database check refuses the pair
 * otherwise. `discarded` has its own endpoint for the same reason: a status
 * transition that must clear or set other columns is not a field edit.
 */
export class UpdateSocialContentIdeaDto {
  @IsOptional()
  @IsString()
  @MaxLength(240)
  title?: string;

  @IsOptional()
  @IsString()
  notes?: string | null;

  @IsOptional()
  @IsUUID()
  pillarId?: string | null;

  @IsOptional()
  @IsUUID()
  campaignInstanceId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  funnelStage?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  contentType?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number;
}

export class ListSocialContentIdeasQueryDto {
  @IsOptional()
  @IsIn(['open', 'converted', 'discarded'])
  status?: 'open' | 'converted' | 'discarded';
}

/**
 * Converting an idea creates real planned content, so it must name the plan
 * that will own it. The plan is validated against the caller's scope like any
 * other resource.
 */
export class ConvertSocialContentIdeaDto {
  @IsUUID()
  planId!: string;

  @IsOptional()
  @Matches(ISO_DATE)
  plannedDate?: string | null;

  /** Overrides the idea's title when the pauta was renamed on the way in. */
  @IsOptional()
  @IsString()
  @MaxLength(240)
  title?: string;
}
