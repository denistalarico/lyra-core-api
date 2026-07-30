import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { LeadFlowIntelligenceDecisionAction } from '../types/intelligence.types';

@Index('IDX_lf_intelligence_decisions_recommendation_created', [
  'recommendationId',
  'createdAt',
])
@Entity('leadflow_intelligence_decisions')
export class LeadFlowIntelligenceDecisionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'recommendation_id', type: 'uuid' })
  recommendationId!: string;

  @Column({ type: 'varchar', length: 24 })
  action!: LeadFlowIntelligenceDecisionAction;

  @Column({ type: 'text', nullable: true })
  reason!: string | null;

  @Column({ name: 'snoozed_until', type: 'timestamptz', nullable: true })
  snoozedUntil!: Date | null;

  @Column({ name: 'actor_user_id', type: 'uuid', nullable: true })
  actorUserId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
