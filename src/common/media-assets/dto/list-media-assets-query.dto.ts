import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * Listing is scoped by the request context alone, so this query carries only
 * paging. The service clamps `limit` again — validation here produces a clear
 * 400 for a caller, the clamp there is the rule.
 */
export class ListMediaAssetsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
