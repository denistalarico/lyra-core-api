import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { LeadFlowIntelligenceJson } from '../types/intelligence.types';

@Index('IDX_lf_intelligence_results_recommendation_measured', [
  'recommendationId',
  'measuredAt',
])
@Entity('leadflow_intelligence_results')
export class LeadFlowIntelligenceResultEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'recommendation_id', type: 'uuid' })
  recommendationId!: string;

  @Column({ name: 'config_version_id', type: 'uuid' })
  configVersionId!: string;

  @Column({ type: 'varchar', length: 30 })
  status!: 'improved' | 'no_change' | 'regressed' | 'insufficient_window';

  @Column({ name: 'period_from', type: 'timestamptz' })
  periodFrom!: Date;

  @Column({ name: 'period_to', type: 'timestamptz' })
  periodTo!: Date;

  @Column({ type: 'jsonb' })
  baseline!: LeadFlowIntelligenceJson;

  @Column({ type: 'jsonb' })
  observed!: LeadFlowIntelligenceJson;

  @Column({ type: 'jsonb' })
  delta!: LeadFlowIntelligenceJson;

  @Column({ type: 'text' })
  conclusion!: string;

  @Column({ name: 'measured_at', type: 'timestamptz' })
  measuredAt!: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
