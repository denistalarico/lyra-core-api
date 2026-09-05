import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type SocialPlanStatus =
  | 'draft'
  | 'in_review'
  | 'client_review'
  | 'approved'
  | 'active'
  | 'completed'
  | 'archived';

@Entity('social_plans')
@Index('IDX_social_plans_scope', [
  'tenantId',
  'workspaceId',
  'agencyClientId',
])
@Index('IDX_social_plans_period', [
  'tenantId',
  'workspaceId',
  'agencyClientId',
  'periodStart',
  'periodEnd',
])
@Check('CK_social_plans_period', '"period_end" >= "period_start"')
@Check(
  'CK_social_plans_status',
  `"status" IN ('draft', 'in_review', 'client_review', 'approved', 'active', 'completed', 'archived')`,
)
export class SocialPlanEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  /**
   * NULL means the agency's own Social context.
   * Non-null means a managed client operated by the agency.
   *
   * This value always comes from the server-resolved managed context,
   * never from a request DTO.
   */
  @Column({ name: 'agency_client_id', type: 'uuid', nullable: true })
  agencyClientId!: string | null;

  @Column({ type: 'varchar', length: 240 })
  title!: string;

  @Column({ name: 'period_start', type: 'date' })
  periodStart!: string;

  @Column({ name: 'period_end', type: 'date' })
  periodEnd!: string;

  @Column({
    type: 'varchar',
    length: 32,
    default: 'draft',
  })
  status!: SocialPlanStatus;

  @Column({
    name: 'primary_objective',
    type: 'varchar',
    length: 120,
    nullable: true,
  })
  primaryObjective!: string | null;

  @Column({
    name: 'strategy_mode',
    type: 'varchar',
    length: 40,
    nullable: true,
  })
  strategyMode!: string | null;

  @Column({ type: 'text', nullable: true })
  summary!: string | null;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById!: string | null;

  @Column({ name: 'updated_by_id', type: 'uuid', nullable: true })
  updatedById!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
