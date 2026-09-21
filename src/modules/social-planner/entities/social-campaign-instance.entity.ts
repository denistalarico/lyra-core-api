import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type SocialCampaignStatus =
  | 'planned'
  | 'active'
  | 'completed'
  | 'archived';

/**
 * A campaign actually being run — "Natal 2026".
 *
 * Deliberately NOT scoped to a plan. A campaign routinely spans two monthly
 * plans, and Creative Studio and Ads are expected to attach to the same row
 * later. Its scope is the Social operational context, exactly like a plan's.
 */
@Entity('social_campaign_instances')
@Index('IDX_social_campaign_instances_scope', [
  'tenantId',
  'workspaceId',
  'agencyClientId',
  'companyContextId',
])
@Index('IDX_social_campaign_instances_period', [
  'tenantId',
  'workspaceId',
  'agencyClientId',
  'companyContextId',
  'startsOn',
  'endsOn',
])
@Check(
  'CK_social_campaign_instances_status',
  `"status" IN ('planned', 'active', 'completed', 'archived')`,
)
@Check(
  'CK_social_campaign_instances_period',
  '"starts_on" IS NULL OR "ends_on" IS NULL OR "ends_on" >= "starts_on"',
)
export class SocialCampaignInstanceEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'agency_client_id', type: 'uuid', nullable: true })
  agencyClientId!: string | null;

  @Column({ name: 'company_context_id', type: 'uuid', nullable: true })
  companyContextId!: string | null;

  /**
   * Provenance only. A template can be deleted while its campaigns keep
   * running, which is why the database sets this to NULL rather than
   * cascading.
   */
  @Column({ name: 'template_id', type: 'uuid', nullable: true })
  templateId!: string | null;

  @Column({ type: 'varchar', length: 240 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  objective!: string | null;

  /**
   * Both dates are optional and independent. A campaign can be created before
   * its window is decided, and an open-ended always-on campaign has a start
   * and no end.
   */
  @Column({ name: 'starts_on', type: 'date', nullable: true })
  startsOn!: string | null;

  @Column({ name: 'ends_on', type: 'date', nullable: true })
  endsOn!: string | null;

  @Column({ type: 'varchar', length: 32, default: 'planned' })
  status!: SocialCampaignStatus;

  /** Presentation hint for the calendar and the planning table. */
  @Column({ type: 'varchar', length: 16, nullable: true })
  color!: string | null;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById!: string | null;

  @Column({ name: 'updated_by_id', type: 'uuid', nullable: true })
  updatedById!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
