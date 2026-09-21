import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

/**
 * One metric the section is showing, as the operator sees it.
 *
 * The value arrives already formatted rather than as a raw decimal, and that is
 * deliberate: the card is the thing being analysed, so the analysis must read
 * the same number the card does — including its currency, its decimal places
 * and its empty state ("alcance do período ainda não medido"). Re-reading the
 * metrics server-side would mean the text could disagree with the screen it was
 * generated from, and the operator would have no way to tell which was wrong.
 *
 * Every field is declared here because the global pipe runs with
 * `whitelist: true`: an undeclared property is stripped, so a nested shape that
 * is not a DTO class arrives empty.
 */
export class SocialAnalyticsInsightMetricDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  label!: string;

  @IsString()
  @MaxLength(120)
  value!: string;

  @IsOptional()
  @IsString()
  @MaxLength(400)
  description?: string | null;
}

/**
 * Bounded at 40. A section with more cards than that is beyond what a few
 * paragraphs can say anything useful about, and the ceiling is also what keeps
 * one request from becoming an unbounded prompt.
 */
const MAX_METRICS = 40;

export class CreateSocialAnalyticsInsightDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  sectionTitle!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(60)
  channelLabel!: string;

  @IsISO8601({ strict: true })
  since!: string;

  @IsISO8601({ strict: true })
  until!: string;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(MAX_METRICS)
  @ValidateNested({ each: true })
  @Type(() => SocialAnalyticsInsightMetricDto)
  metrics!: SocialAnalyticsInsightMetricDto[];
}
