import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import type { SocialPlanStatus } from '../entities';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class CreateSocialPlanDto {
  @IsString()
  @MaxLength(240)
  title!: string;

  @Matches(ISO_DATE)
  periodStart!: string;

  @Matches(ISO_DATE)
  periodEnd!: string;

  @IsOptional()
  @IsIn([
    'draft',
    'in_review',
    'client_review',
    'approved',
    'active',
    'completed',
    'archived',
  ] satisfies SocialPlanStatus[])
  status?: SocialPlanStatus;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  primaryObjective?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  strategyMode?: string | null;

  @IsOptional()
  @IsString()
  summary?: string | null;
}
