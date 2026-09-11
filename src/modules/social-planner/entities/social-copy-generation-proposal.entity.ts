import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * The editorial text fields a run may propose. A closed list, not a free
 * string: the generator proposes into the same six fields the Planner already
 * persists on the content item and snapshots on a revision, and a seventh
 * invented by a model would be silently dropped later, which reads to the
 * operator as "the generation produced nothing".
 */
export type SocialCopyGenerationField =
  | 'copy'
  | 'caption'
  | 'script'
  | 'cta'
  | 'hashtags'
  | 'firstComment';

export const SOCIAL_COPY_GENERATION_FIELDS: readonly SocialCopyGenerationField[] =
  ['copy', 'caption', 'script', 'cta', 'hashtags', 'firstComment'];

export type SocialCopyGenerationProposalStatus =
  | 'pending'
  | 'accepted'
  | 'rejected'
  | 'superseded';

/**
 * One field-level proposal produced by one generation run (Planner E8).
 *
 * WHY GENERATED TEXT DOES NOT LAND ON THE CONTENT ITEM
 * ---------------------------------------------------
 * E8 requires that copy is never overwritten without confirmation, and §29 of
 * the blueprint says the AI recommends and explains and must not silently alter
 * important objects. A worker that wrote straight to `social_content_items`
 * would violate both the moment it succeeded — there would be no state in which
 * the operator had something to approve. So the run's output stops here, and
 * `value` becomes content only through an explicit accept that creates a
 * revision. This mirrors `leadflow_briefing_suggestions`, the one staged-approval
 * contract this codebase already has.
 *
 * WHY `base_value` IS STORED
 * --------------------------
 * Accepting is a decision about a specific "before". If the operator edited the
 * caption by hand in the twenty minutes the run took, accepting blindly would
 * destroy that edit and call it provenance. `base_value` is what the field held
 * when the prompt was built, so the accept can refuse on a changed base and say
 * so, instead of resolving a conflict nobody was shown.
 *
 * `value` IS JSONB BECAUSE ONE FIELD IS NOT TEXT
 * ---------------------------------------------
 * Five of the six fields are strings; `hashtags` is a string array on both the
 * content item and the revision. A text column would force this row to either
 * invent a separator or exclude hashtags from generation, and the E8 scope
 * explicitly includes them.
 */
@Entity('social_copy_generation_proposals')
@Index('IDX_social_copy_proposals_scope', [
  'tenantId',
  'workspaceId',
  'agencyClientId',
])
@Index('IDX_social_copy_proposals_content', ['contentItemId', 'status'])
@Index('UQ_social_copy_proposals_run_field', ['runId', 'field'], {
  unique: true,
})
@Check(
  'CK_social_copy_proposals_field',
  `"field" IN ('copy', 'caption', 'script', 'cta', 'hashtags', 'first_comment')`,
)
@Check(
  'CK_social_copy_proposals_status',
  `"status" IN ('pending', 'accepted', 'rejected', 'superseded')`,
)
export class SocialCopyGenerationProposalEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'agency_client_id', type: 'uuid', nullable: true })
  agencyClientId!: string | null;

  @Column({ name: 'run_id', type: 'uuid' })
  runId!: string;

  @Column({ name: 'content_item_id', type: 'uuid' })
  contentItemId!: string;

  /**
   * Stored in the database's snake_case vocabulary (`first_comment`) and mapped
   * to the contract's camelCase at the view boundary, like every other column
   * in this module.
   */
  @Column({ type: 'varchar', length: 40 })
  field!: string;

  @Column({ type: 'jsonb' })
  value!: unknown;

  /** What the field held when the prompt was built. NULL means it was empty. */
  @Column({ name: 'base_value', type: 'jsonb', nullable: true })
  baseValue!: unknown;

  /** One short sentence from the model explaining the proposal (§29: explain). */
  @Column({ type: 'varchar', length: 500, nullable: true })
  rationale!: string | null;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status!: SocialCopyGenerationProposalStatus;

  /** The revision the accept produced, so provenance is traversable both ways. */
  @Column({ name: 'applied_revision_id', type: 'uuid', nullable: true })
  appliedRevisionId!: string | null;

  @Column({ name: 'decided_by_id', type: 'uuid', nullable: true })
  decidedById!: string | null;

  @Column({ name: 'decided_at', type: 'timestamptz', nullable: true })
  decidedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
