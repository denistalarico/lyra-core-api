import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

export type SocialContentRevisionSource =
  | 'human'
  | 'ai'
  | 'ai_then_human'
  | 'human_then_ai'
  | 'restored'
  | 'import';

@Entity('social_content_revisions')
@Unique('UQ_social_content_revisions_number', [
  'contentItemId',
  'revisionNumber',
])
@Index('IDX_social_content_revisions_scope', [
  'tenantId',
  'workspaceId',
  'agencyClientId',
])
@Index('IDX_social_content_revisions_content', [
  'contentItemId',
  'revisionNumber',
])
@Check(
  'CK_social_content_revisions_source',
  `"source" IN ('human', 'ai', 'ai_then_human', 'human_then_ai', 'restored', 'import')`,
)
@Check(
  'CK_social_content_revisions_number',
  '"revision_number" > 0',
)
@Check(
  'CK_social_content_revisions_hashtags_array',
  `jsonb_typeof("hashtags") = 'array'`,
)
export class SocialContentRevisionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'agency_client_id', type: 'uuid', nullable: true })
  agencyClientId!: string | null;

  @Column({ name: 'content_item_id', type: 'uuid' })
  contentItemId!: string;

  @Column({ name: 'revision_number', type: 'integer' })
  revisionNumber!: number;

  @Column({ type: 'text', nullable: true })
  copy!: string | null;

  @Column({ type: 'text', nullable: true })
  caption!: string | null;

  @Column({ type: 'text', nullable: true })
  script!: string | null;

  @Column({ type: 'text', nullable: true })
  cta!: string | null;

  @Column({
    type: 'jsonb',
    default: () => "'[]'::jsonb",
  })
  hashtags!: string[];

  @Column({
    name: 'first_comment',
    type: 'text',
    nullable: true,
  })
  firstComment!: string | null;

  /**
   * Snapshot of the brief used when this revision was produced.
   * The current brief continues to live on SocialContentItem.
   */
  @Column({
    name: 'brief_snapshot',
    type: 'text',
    nullable: true,
  })
  briefSnapshot!: string | null;

  @Column({
    type: 'varchar',
    length: 32,
    default: 'human',
  })
  source!: SocialContentRevisionSource;

  /**
   * Lineage between revisions. A restored/refined revision can point to the
   * version it originated from without mutating historical rows.
   */
  @Column({
    name: 'parent_revision_id',
    type: 'uuid',
    nullable: true,
  })
  parentRevisionId!: string | null;

  /**
   * Reference to the Intelligence Layer generation run.
   *
   * No physical FK yet: the shared generation-run persistence is being
   * established independently and the Planner must not bind itself to a
   * provider-specific or LeadFlow-specific table.
   */
  @Column({
    name: 'generation_run_id',
    type: 'uuid',
    nullable: true,
  })
  generationRunId!: string | null;

  @Column({
    name: 'created_by_id',
    type: 'uuid',
    nullable: true,
  })
  createdById!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
