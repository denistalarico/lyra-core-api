import { IsIn, IsOptional } from 'class-validator';

export type SocialContentArchivedFilter = 'exclude' | 'include' | 'only';

/**
 * Which lifecycle slice of a plan's content to read (E6).
 *
 * A three-value selector rather than a boolean, because the UI has three real
 * views and a boolean can only express two: the working list (`exclude`, the
 * default), the archive screen (`only`), and the rare "show me everything"
 * (`include`).
 *
 * There is no value for soft-deleted content. It is not a view the Planner
 * offers, and making it expressible in a query string would turn an internal
 * lifecycle detail into part of the public contract.
 */
export class ListSocialPlanContentQueryDto {
  @IsOptional()
  @IsIn(['exclude', 'include', 'only'])
  archived?: SocialContentArchivedFilter;
}
