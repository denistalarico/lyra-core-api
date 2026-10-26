import { IsOptional, IsString } from 'class-validator';

/**
 * Both fields optional and independent: the inline editor saves the title and
 * the description separately. Lengths are checked after trimming, in the
 * service, so surrounding whitespace never counts against the limit.
 */
export class UpdateAnalyticsOverviewHeaderDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string | null;
}
