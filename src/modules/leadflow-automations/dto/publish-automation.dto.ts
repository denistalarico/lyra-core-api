import { IsInt, IsOptional, Min } from 'class-validator';

/**
 * The version the operator reviewed immediately before publishing.  Publishing
 * remains idempotent only for a fresh review: a newer immutable snapshot must
 * be reviewed explicitly instead of being overwritten by a stale tab.
 */
export class PublishAutomationDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  expectedVersion?: number;
}
