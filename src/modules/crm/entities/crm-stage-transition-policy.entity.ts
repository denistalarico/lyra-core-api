import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type CrmStageTransitionActor = 'human' | 'ai' | 'automation' | 'system';

export type CrmStageTransitionPolicyStatus = 'draft' | 'published' | 'inactive';

export type CrmStageTransitionCondition = {
  field: string;
  operator: 'present' | 'equals' | 'not_equals' | 'in';
  value?: unknown;
};

export type CrmStageTransitionConditionContract = {
  all?: CrmStageTransitionCondition[];
};

@Entity('crm_stage_transition_policies')
export class CrmStageTransitionPolicyEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'pipeline_id', type: 'uuid' })
  pipelineId!: string;

  @Column({ name: 'from_stage_id', type: 'uuid' })
  fromStageId!: string;

  @Column({ name: 'to_stage_id', type: 'uuid' })
  toStageId!: string;

  @Column({
    name: 'allowed_actors',
    type: 'jsonb',
    default: () => "'[]'::jsonb",
  })
  allowedActors!: CrmStageTransitionActor[];

  @Column({
    name: 'required_fields',
    type: 'jsonb',
    default: () => "'[]'::jsonb",
  })
  requiredFields!: string[];

  @Column({
    name: 'condition_contract',
    type: 'jsonb',
    default: () => "'{}'::jsonb",
  })
  conditionContract!: CrmStageTransitionConditionContract;

  @Column({ name: 'reason_codes', type: 'jsonb', default: () => "'[]'::jsonb" })
  reasonCodes!: string[];

  @Column({ name: 'ai_guidance', type: 'text', nullable: true })
  aiGuidance!: string | null;

  @Column({ type: 'varchar', length: 24, default: 'draft' })
  status!: CrmStageTransitionPolicyStatus;

  @Column({ type: 'int' })
  version!: number;

  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt!: Date | null;

  @Column({ name: 'published_by_id', type: 'uuid', nullable: true })
  publishedById!: string | null;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById!: string | null;

  @Column({ name: 'superseded_by_policy_id', type: 'uuid', nullable: true })
  supersededByPolicyId!: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
