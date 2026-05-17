import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

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

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
