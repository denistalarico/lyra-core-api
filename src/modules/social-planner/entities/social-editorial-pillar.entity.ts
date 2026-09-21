import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * An editorial pillar — the recurring subject a piece of content belongs to
 * ("bastidores", "prova social", "educativo").
 *
 * Pillars answer a coverage question, so they carry a target share and are
 * queried per plan by counting the content that references them.
 */
@Entity('social_editorial_pillars')
@Index('IDX_social_editorial_pillars_scope', [
  'tenantId',
  'workspaceId',
  'agencyClientId',
  'companyContextId',
])
@Check('CK_social_editorial_pillars_key', `"key" ~ '^[a-z0-9][a-z0-9_-]*$'`)
@Check(
  'CK_social_editorial_pillars_target',
  '"target_percentage" IS NULL OR ("target_percentage" >= 0 AND "target_percentage" <= 100)',
)
@Check('CK_social_editorial_pillars_sort_order', '"sort_order" >= 0')
export class SocialEditorialPillarEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'agency_client_id', type: 'uuid', nullable: true })
  agencyClientId!: string | null;

  @Column({ name: 'company_context_id', type: 'uuid', nullable: true })
  companyContextId!: string | null;

  /**
   * Stable machine key. Content references the pillar by id, but reporting
   * across renames and template suggestions both go through this key, so it is
   * unique per scope and immutable once created.
   */
  @Column({ type: 'varchar', length: 80 })
  key!: string;

  @Column({ type: 'varchar', length: 160 })
  label!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  /**
   * Intended share of a plan, as a percentage.
   *
   * NULL is meaningful: the pillar is tracked but has no target, so coverage
   * reports its actual share and no deviation. Stored as numeric, which the
   * driver returns as a string; the service is responsible for the conversion.
   */
  @Column({
    name: 'target_percentage',
    type: 'numeric',
    precision: 5,
    scale: 2,
    nullable: true,
  })
  targetPercentage!: string | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  color!: string | null;

  @Column({ name: 'sort_order', type: 'integer', default: 0 })
  sortOrder!: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById!: string | null;

  @Column({ name: 'updated_by_id', type: 'uuid', nullable: true })
  updatedById!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
