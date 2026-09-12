import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * How many commemorative dates one generation may carry.
 *
 * Each selected date becomes a constraint in the prompt, and a list long enough
 * to dominate the context would turn an editorial plan into a calendar of
 * holidays. The cap is generous for a quarter and still bounded.
 */
export const SOCIAL_PLAN_GENERATION_MAX_DATES = 60;

/**
 * The ceiling on how many content items one generated plan may contain.
 *
 * This is a spend guard as much as a payload guard: the grid is produced by one
 * provider call, but every item it creates is a future copy-generation call.
 */
export const SOCIAL_PLAN_GENERATION_MAX_ITEMS = 120;

/**
 * Asks the model to build the editorial grid for a plan (Planner AI).
 *
 * WHAT THIS DELIBERATELY DOES NOT CARRY
 * -------------------------------------
 * No copy, caption, script, hashtags or CTA. Plan generation and copy
 * generation are two separate decisions the operator makes at two different
 * times, and collapsing them would mean paying to write text for a calendar the
 * operator has not yet agreed to. The response schema enforces the same split.
 *
 * Scope is never read from this body — it comes from the request context, the
 * same rule every other Planner endpoint follows.
 */
export class RequestSocialPlanGenerationDto {
  /**
   * Free-text steer from the operator. This IS instruction to the model, unlike
   * the editorial context, because it was typed here and now. Length-capped so
   * it cannot become a channel for a large prompt payload.
   */
  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  instruction?: string | null;

  /**
   * How many content items to produce. Omitted means the Planner settings'
   * configured monthly volume, scaled to the plan's period — the operator
   * already declared that number once and should not have to repeat it.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(SOCIAL_PLAN_GENERATION_MAX_ITEMS)
  itemCount?: number;

  /**
   * Commemorative date keys the operator ticked. The dates themselves are
   * re-derived server-side from these keys: a body that carried its own dates
   * would let a caller place content outside the plan period.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(SOCIAL_PLAN_GENERATION_MAX_DATES)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  commemorativeDateKeys?: string[];

  /**
   * Restricts commemorative content to Story placements.
   *
   * Separate from the date list rather than a property of each date: it is one
   * editorial decision about how seasonal moments are treated, not a per-date
   * setting, and the operator sets it with one checkbox.
   */
  @IsOptional()
  @IsBoolean()
  commemorativeStoryOnly?: boolean;
}

/**
 * Query for the commemorative date picker.
 *
 * The period is required because a rule-based catalog has no dates until it is
 * given one — "Carnival" is not a date, it is a rule about a year.
 */
export class ListCommemorativeDatesQueryDto {
  @IsDateString()
  periodStart!: string;

  @IsDateString()
  periodEnd!: string;

  /**
   * ISO 3166-1 alpha-2. Omitted falls back to the country configured on the
   * Brand Kit address, and then to offering everything.
   */
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z]{2}$/, {
    message: 'country must be an ISO 3166-1 alpha-2 code',
  })
  country?: string;

  /**
   * Omitted falls back to the client's configured LeadFlow business mode. An
   * explicit value lets the operator preview another segment's dates without
   * changing any configuration.
   */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  businessMode?: string;
}
