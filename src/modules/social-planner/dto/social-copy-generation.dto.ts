import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import {
  SOCIAL_COPY_GENERATION_FIELDS,
  type SocialCopyGenerationField,
} from '../entities';

/**
 * The cap on one fan-out request (E8).
 *
 * A selection request enqueues one run per item and every run is a paid provider
 * call, so this ceiling is a spend guard, not just a payload guard. The
 * configured `maxItemsPerRequest` narrows it further at runtime; this is the
 * absolute limit the contract will accept.
 */
export const SOCIAL_COPY_GENERATION_MAX_ITEMS = 200;

/**
 * Requests generation for one content item.
 *
 * There is no scope and no plan id here, for the same reason
 * `SocialContentBatchDto` omits them: scope comes from the request context and
 * the plan is read from the row the service actually resolved, never from a
 * second untrusted statement in the body.
 */
export class RequestSocialCopyGenerationDto {
  /**
   * Which fields to generate. Omitted means "the ones this content still needs",
   * decided by the service from the item's own state — a caller should not have
   * to know the editorial rules (a script only applies to video formats) to ask
   * for a sensible generation.
   */
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(SOCIAL_COPY_GENERATION_FIELDS.length)
  @IsIn(SOCIAL_COPY_GENERATION_FIELDS as unknown as string[], { each: true })
  fields?: SocialCopyGenerationField[];

  /**
   * Free-text steer from the operator ("mais curto", "tom mais formal").
   *
   * This one IS treated as instruction by the prompt, unlike the editorial
   * context, because the operator typed it here and now. It is length-capped so
   * it cannot become a channel for smuggling a large payload into the prompt.
   */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  instruction?: string | null;
}

/** Requests generation across an explicit selection of items. */
export class RequestSocialCopyGenerationBatchDto extends RequestSocialCopyGenerationDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(SOCIAL_COPY_GENERATION_MAX_ITEMS)
  @IsUUID(undefined, { each: true })
  contentIds!: string[];
}

/**
 * Accepts staged proposals onto the content, creating one revision.
 *
 * Accepting is explicit and per-proposal: E8 forbids overwriting copy without
 * confirmation, so there is no "accept the whole run" shortcut that would let a
 * single click replace six fields the operator reviewed only one of.
 */
export class AcceptSocialCopyProposalsDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(SOCIAL_COPY_GENERATION_FIELDS.length)
  @IsUUID(undefined, { each: true })
  proposalIds!: string[];

  /**
   * Accept even though the field changed since the prompt was built.
   *
   * Default refusal is the safe one: a base that moved means someone edited by
   * hand while the run was in flight, and accepting silently would destroy that
   * edit. The flag exists so the operator who was shown the conflict can still
   * choose the generated text — a decision, not a default.
   */
  @IsOptional()
  overrideChangedBase?: boolean;
}

/**
 * Discards staged proposals without touching the content.
 *
 * A separate DTO rather than a flag on the accept payload: "apply these" and
 * "discard these" are different decisions with different consequences, and one
 * endpoint that did both would make a mistyped boolean overwrite copy.
 */
export class RejectSocialCopyProposalsDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(SOCIAL_COPY_GENERATION_FIELDS.length)
  @IsUUID(undefined, { each: true })
  proposalIds!: string[];
}
