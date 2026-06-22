import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('team_config_options')
@Index('idx_team_config_options_tenant_workspace_type', [
  'tenantId',
  'workspaceId',
  'type',
])
export class TeamConfigOption {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ type: 'varchar', length: 80 })
  type!:
    | 'job_title'
    | 'role_name'
    | 'seniority'
    | 'work_mode'
    | 'worker_type'
    | 'offboarding_reason'
    | 'contract_category'
    | 'signature_provider'
    | 'onboarding_task'
    | 'offboarding_task'
    | 'skill_category'
    | 'skill_level'
    | 'onboarding_template'
    | 'offboarding_template'
    | 'payment_benefit_template'
    | 'payment_discount_template'
    | 'payment_document_template'
    | 'payment_finance_setting'
    | 'client_loss_reason'
    | 'client_onboarding_template'
    | 'client_offboarding_template'
    | 'lifecycle_step_type'
    | 'client_lifecycle_step_type'
    | 'client_onboarding_task'
    | 'client_offboarding_task';

  @Column({ type: 'varchar', length: 160 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'varchar', length: 24, nullable: true })
  color!: string | null;

  @Column({ type: 'varchar', length: 24, default: 'active' })
  status!: 'active' | 'archived';

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById!: string | null;

  @Column({ name: 'updated_by_id', type: 'uuid', nullable: true })
  updatedById!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
