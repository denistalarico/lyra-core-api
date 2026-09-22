import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsUUID } from 'class-validator';

/**
 * Local publication ids whose organic metrics should be read.
 *
 * Scope is deliberately absent: tenant, workspace and managed client always
 * come from the authenticated request context.
 */
export class PublicationMetricsQueryDto {
  /** Accepts repeated query keys and a single comma-separated key. */
  @Transform(({ value }: { value: unknown }) => {
    const values = Array.isArray(value) ? value : [value];

    return values.flatMap((item): string[] =>
      typeof item === 'string' ? item.split(',').filter(Boolean) : [],
    );
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true })
  publicationIds!: string[];
}
