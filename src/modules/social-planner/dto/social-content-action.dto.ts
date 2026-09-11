import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsUUID } from 'class-validator';

/**
 * The cap on one batch (E6).
 *
 * A batch is revalidated item by item inside a single request, so the ceiling
 * is what keeps one call from holding a connection long enough to matter. 200
 * is above any plausible month of content in one plan and far below the point
 * where the request stops being interactive; a caller with more work than that
 * is expected to page, which also keeps its own partial-result reporting
 * legible.
 */
export const SOCIAL_CONTENT_BATCH_MAX = 200;

/**
 * The batch selection, and nothing else.
 *
 * There is deliberately no scope here and no plan id. Scope comes from the
 * request context, and the plan is not accepted because it would be a second,
 * untrusted statement about where these items live — the service resolves each
 * id in the caller's scope and reads the plan from the row it actually found.
 */
export class SocialContentBatchDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(SOCIAL_CONTENT_BATCH_MAX)
  @IsUUID(undefined, { each: true })
  contentIds!: string[];
}
