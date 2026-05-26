import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('finance_profitability_rules')
export class FinanceProfitabilityRule {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'default_hourly_cost', type: 'numeric', precision: 14, scale: 2, default: 0 })
  defaultHourlyCost!: string;

  @Column({ name: 'healthy_margin_threshold', type: 'numeric', precision: 8, scale: 4, default: 0.4 })
  healthyMarginThreshold!: string;

  @Column({ name: 'attention_margin_threshold', type: 'numeric', precision: 8, scale: 4, default: 0.2 })
  attentionMarginThreshold!: string;

  @Column({ name: 'risk_margin_threshold', type: 'numeric', precision: 8, scale: 4, default: 0 })
  riskMarginThreshold!: string;

  @Column({ name: 'overhead_allocation_method', type: 'varchar', length: 80, default: 'revenue_share' })
  overheadAllocationMethod!: string;

  @Column({ name: 'include_fixed_costs_in_client_margin', type: 'boolean', default: true })
  includeFixedCostsInClientMargin!: boolean;

  @Column({ name: 'include_team_time_costs', type: 'boolean', default: true })
  includeTeamTimeCosts!: boolean;

  @Column({ name: 'metadata', type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
