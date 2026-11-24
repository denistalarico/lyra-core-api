import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** The Social channels a context can switch off, by integrations-card key. */
export const SOCIAL_TOGGLEABLE_CHANNELS = [
  'instagram',
  'facebook',
  'metaads',
  'google-ads',
  'google-analytics',
  'linkedin',
  'linkedin-ads',
  'youtube',
  'tiktok',
  'tiktok-ads',
  'threads',
] as const;
export type SocialToggleableChannel =
  (typeof SOCIAL_TOGGLEABLE_CHANNELS)[number];

/**
 * A channel switched off in one context. Turning it off keeps the connection
 * and its configuration; the product only stops offering the channel
 * (Planner destinations, Campanhas, Analytics). No row means enabled.
 */
@Entity('social_channel_preferences')
export class SocialChannelPreferenceEntity {
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

  @Column({ type: 'varchar', length: 40 })
  channel!: SocialToggleableChannel;

  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  @Column({ name: 'updated_by_id', type: 'uuid', nullable: true })
  updatedById!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
