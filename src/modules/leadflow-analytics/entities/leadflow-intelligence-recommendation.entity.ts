import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { LeadFlowSettingsContextType } from '../../leadflow-settings/enums/leadflow-settings-context-type.enum';
import type {
  LeadFlowIntelligenceEvidence,
  LeadFlowIntelligenceJson,
  LeadFlowIntelligenceRecommendationKind,
  LeadFlowIntelligenceRecommendationStatus,
  LeadFlowIntelligenceTargetType,
} from '../types/intelligence.types';

@Index('IDX_lf_intelligence_recommendations_scope_status', [
  'tenantId',
  'workspaceId',
  'contextType',
  'agencyClientId',
  'status',
])
@Index('IDX_lf_intelligence_recommendations_target', [
  'tenantId',
  'workspaceId',
  'targetType',
  'targetId',
])
@Index(
  'UQ_lf_intelligence_recommendations_generation',
  ['tenantId', 'workspaceId', 'contextType', 'agencyClientId', 'generationKey'],
  { unique: true },
)
@Entity('leadflow_intelligence_recommendations')
export class LeadFlowIntelligenceRecommendationEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'context_type', type: 'varchar', length: 30 })
  contextType!: LeadFlowSettingsContextType;

  @Column({ name: 'agency_client_id', type: 'uuid', nullable: true })
  agencyClientId!: string | null;

  @Column({ name: 'business_mode_key', type: 'varchar', length: 80 })
  businessModeKey!: string;

  @Column({ name: 'generation_key', type: 'varchar', length: 240 })
  generationKey!: string;

  @Column({ type: 'varchar', length: 80 })
  kind!: LeadFlowIntelligenceRecommendationKind;

  @Column({ type: 'varchar', length: 24, default: 'pending' })
  status!: LeadFlowIntelligenceRecommendationStatus;

  @Column({ name: 'target_type', type: 'varchar', length: 40 })
  targetType!: LeadFlowIntelligenceTargetType;

  @Column({ name: 'target_id', type: 'uuid' })
  targetId!: string;

  @Column({ name: 'target_label', type: 'varchar', length: 180 })
  targetLabel!: string;

  @Column({ type: 'varchar', length: 180 })
  title!: string;

  @Column({ type: 'text' })
  rationale!: string;

  @Column({ name: 'period_from', type: 'timestamptz' })
  periodFrom!: Date;

  @Column({ name: 'period_to', type: 'timestamptz' })
  periodTo!: Date;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  segment!: LeadFlowIntelligenceJson;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  evidence!: LeadFlowIntelligenceEvidence[];

  @Column({ type: 'real' })
  confidence!: number;

  @Column({ name: 'expected_impact', type: 'jsonb' })
  expectedImpact!: LeadFlowIntelligenceJson;

  @Column({ name: 'current_config', type: 'jsonb' })
  currentConfig!: LeadFlowIntelligenceJson;

  @Column({ name: 'proposed_config', type: 'jsonb' })
  proposedConfig!: LeadFlowIntelligenceJson;

  @Column({ type: 'jsonb' })
  baseline!: LeadFlowIntelligenceJson;

  @Column({ name: 'snoozed_until', type: 'timestamptz', nullable: true })
  snoozedUntil!: Date | null;

  @Column({ name: 'applied_at', type: 'timestamptz', nullable: true })
  appliedAt!: Date | null;

  @Column({ name: 'measurement_due_at', type: 'timestamptz', nullable: true })
  measurementDueAt!: Date | null;

  @Column({ name: 'rolled_back_at', type: 'timestamptz', nullable: true })
  rolledBackAt!: Date | null;

  @Column({ name: 'applied_version_id', type: 'uuid', nullable: true })
  appliedVersionId!: string | null;

  @Column({ name: 'rollback_version_id', type: 'uuid', nullable: true })
  rollbackVersionId!: string | null;

  @Column({ name: 'latest_result_id', type: 'uuid', nullable: true })
  latestResultId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
