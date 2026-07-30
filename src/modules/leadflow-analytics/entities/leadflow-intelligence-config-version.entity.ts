import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type {
  LeadFlowIntelligenceJson,
  LeadFlowIntelligenceTargetType,
} from '../types/intelligence.types';

@Index(
  'UQ_lf_intelligence_config_versions_target_version',
  ['tenantId', 'workspaceId', 'targetType', 'targetId', 'version'],
  { unique: true },
)
@Index('IDX_lf_intelligence_config_versions_recommendation', [
  'recommendationId',
])
@Entity('leadflow_intelligence_config_versions')
export class LeadFlowIntelligenceConfigVersionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'recommendation_id', type: 'uuid' })
  recommendationId!: string;

  @Column({ name: 'target_type', type: 'varchar', length: 40 })
  targetType!: LeadFlowIntelligenceTargetType;

  @Column({ name: 'target_id', type: 'uuid' })
  targetId!: string;

  @Column({ type: 'integer' })
  version!: number;

  @Column({ type: 'varchar', length: 24, default: 'applied' })
  status!: 'applied' | 'rolled_back';

  @Column({ name: 'previous_config', type: 'jsonb' })
  previousConfig!: LeadFlowIntelligenceJson;

  @Column({ type: 'jsonb' })
  config!: LeadFlowIntelligenceJson;

  @Column({
    name: 'rollback_of_version_id',
    type: 'uuid',
    nullable: true,
  })
  rollbackOfVersionId!: string | null;

  @Column({ name: 'applied_by_id', type: 'uuid', nullable: true })
  appliedById!: string | null;

  @Column({ name: 'applied_at', type: 'timestamptz' })
  appliedAt!: Date;

  @Column({ name: 'rolled_back_at', type: 'timestamptz', nullable: true })
  rolledBackAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
