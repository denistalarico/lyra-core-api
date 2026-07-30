import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { LEADFLOW_INTELLIGENCE_RECOMMENDATION_STATUSES } from '../types/intelligence.types';

export class GetIntelligenceRecommendationsDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Matches(/^[a-z0-9][a-z0-9_-]*$/i)
  businessMode?: string;

  @IsOptional()
  @IsIn(LEADFLOW_INTELLIGENCE_RECOMMENDATION_STATUSES)
  status?: (typeof LEADFLOW_INTELLIGENCE_RECOMMENDATION_STATUSES)[number];
}
