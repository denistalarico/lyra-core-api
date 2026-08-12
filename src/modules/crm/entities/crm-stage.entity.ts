import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * D4: the structural role a stage plays in the pipeline. Independent from the
 * legacy `type`/`is_*_stage` flags (which Agency Sales still uses). Multiple
 * `qualification`/`follow_up`/`contacted`/`custom` stages are allowed;
 * `entry`/`won`/`lost`/`handoff` are unique per pipeline.
 */
export type CrmStageRole =
  | 'entry'
  | 'contacted'
  | 'qualification'
  | 'handoff'
  | 'follow_up'
  | 'won'
  | 'lost'
  | 'custom';

export const CRM_STAGE_ROLES: readonly CrmStageRole[] = [
  'entry',
  'contacted',
  'qualification',
  'handoff',
  'follow_up',
  'won',
  'lost',
  'custom',
];

/**
 * Roles that may appear at most once per pipeline. `handoff` joined them when
 * the settings screen started offering it as a marking: a pipeline with two
 * "atender" stages has no single place for a person to take the conversation
 * over. Clearing a duplicate is always possible — `custom` is not governed.
 */
export const CRM_UNIQUE_STAGE_ROLES: ReadonlySet<CrmStageRole> = new Set([
  'entry',
  'won',
  'lost',
  'handoff',
]);

@Entity('crm_stages')
export class CrmStageEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'pipeline_id', type: 'uuid' })
  pipelineId!: string;

  @Column({ type: 'varchar', length: 140 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'varchar', length: 32, default: 'open' })
  type!: string;

  @Column({ type: 'varchar', length: 32, nullable: true })
  color!: string | null;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder!: number;

  @Column({ type: 'int', default: 0 })
  probability!: number;

  @Column({ name: 'is_won_stage', type: 'boolean', default: false })
  isWonStage!: boolean;

  @Column({ name: 'is_lost_stage', type: 'boolean', default: false })
  isLostStage!: boolean;

  @Column({ name: 'is_folded', type: 'boolean', default: false })
  isFolded!: boolean;

  @Column({ name: 'is_initial_stage', type: 'boolean', default: false })
  isInitialStage!: boolean;

  @Column({
    name: 'operation_mode',
    type: 'varchar',
    length: 24,
    default: 'hybrid',
  })
  operationMode!: 'ai_managed' | 'human_managed' | 'hybrid';

  /** D4: structural role of this stage. Default `custom`; see {@link CrmStageRole}. */
  @Column({ type: 'varchar', length: 24, default: 'custom' })
  role!: CrmStageRole;

  /** Role-specific configuration (e.g. qualification criteria, follow-up settings). */
  @Column({ name: 'role_config', type: 'jsonb', default: () => "'{}'::jsonb" })
  roleConfig!: Record<string, unknown>;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
