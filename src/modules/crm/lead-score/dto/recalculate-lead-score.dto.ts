import { IsString, Length } from 'class-validator';

/**
 * Input for a manual recalculation.
 *
 * Carries an explanation and nothing more. Accepting a score, a feature set or
 * a breakdown would let an operator write a number the engine never computed,
 * which is precisely the property the whole design exists to prevent.
 */
export class RecalculateLeadScoreDto {
  /** Why the operator asked. Recorded for audit. */
  @IsString()
  @Length(3, 120)
  reason!: string;
}
