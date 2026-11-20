import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * GA-CONV (D-G6, revised 2026-11-20): per Google Ads connection, which
 * `UPLOAD_CLICKS` actions receive "qualified" and "won", and which stage of
 * each funnel (Agency or LeadFlow CRM) counts as qualified. Off by default.
 */
@Entity('google_ads_conversion_upload_settings')
export class GoogleAdsConversionUploadSettingsEntity {
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

  @Column({ name: 'connection_id', type: 'uuid' })
  connectionId!: string;

  @Column({ type: 'boolean', default: false })
  enabled!: boolean;

  @Column({
    name: 'qualified_action_resource',
    type: 'varchar',
    length: 200,
    nullable: true,
  })
  qualifiedActionResource!: string | null;

  @Column({
    name: 'won_action_resource',
    type: 'varchar',
    length: 200,
    nullable: true,
  })
  wonActionResource!: string | null;

  @Column({
    name: 'qualified_stage_ids',
    type: 'jsonb',
    default: () => "'[]'::jsonb",
  })
  qualifiedStageIds!: string[];

  @Column({ name: 'send_value', type: 'boolean', default: true })
  sendValue!: boolean;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById!: string | null;

  @Column({ name: 'updated_by_id', type: 'uuid', nullable: true })
  updatedById!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
