import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import type { ClientAreaRole } from '../client-area.types';

/** Agency-level configuration.  It intentionally holds only Client Area
 * overrides; Agency identity continues to live in workspace_company_settings. */
@Entity('client_area_settings')
@Unique('UQ_client_area_settings_tenant_workspace', ['tenantId', 'workspaceId'])
export class ClientAreaSettingsEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;
  @Column({ name: 'workspace_id', type: 'uuid' }) workspaceId!: string;
  @Column({ type: 'boolean', default: false }) enabled!: boolean;
  @Column({
    name: 'branding_mode',
    type: 'varchar',
    length: 16,
    default: 'agency',
  })
  brandingMode!: 'agency' | 'custom';
  @Column({
    name: 'display_name',
    type: 'varchar',
    length: 120,
    nullable: true,
  })
  displayName!: string | null;
  @Column({ name: 'logo_light_url', type: 'text', nullable: true })
  logoLightUrl!: string | null;
  @Column({ name: 'logo_dark_url', type: 'text', nullable: true })
  logoDarkUrl!: string | null;
  @Column({ name: 'mark_light_url', type: 'text', nullable: true })
  markLightUrl!: string | null;
  @Column({ name: 'mark_dark_url', type: 'text', nullable: true })
  markDarkUrl!: string | null;
  @Column({ name: 'favicon_url', type: 'text', nullable: true }) faviconUrl!:
    | string
    | null;
  @Column({ name: 'primary_color', type: 'varchar', length: 7, nullable: true })
  primaryColor!: string | null;
  @Column({
    name: 'secondary_color',
    type: 'varchar',
    length: 7,
    nullable: true,
  })
  secondaryColor!: string | null;
  @Column({
    name: 'login_layout',
    type: 'varchar',
    length: 16,
    default: 'centered',
  })
  loginLayout!: 'centered' | 'split';
  @Column({
    name: 'login_heading',
    type: 'varchar',
    length: 160,
    nullable: true,
  })
  loginHeading!: string | null;
  @Column({
    name: 'login_supporting_text',
    type: 'varchar',
    length: 500,
    nullable: true,
  })
  loginSupportingText!: string | null;
  @Column({
    name: 'login_background_color',
    type: 'varchar',
    length: 7,
    nullable: true,
  })
  loginBackgroundColor!: string | null;
  @Column({
    name: 'default_role',
    type: 'varchar',
    length: 24,
    default: 'client_viewer',
  })
  defaultRole!: ClientAreaRole;
  @Column({
    name: 'approvals_default_enabled',
    type: 'boolean',
    default: false,
  })
  approvalsDefaultEnabled!: boolean;
  @Column({
    name: 'domain_mode',
    type: 'varchar',
    length: 16,
    default: 'default',
  })
  domainMode!: 'default' | 'custom';
  @Column({
    name: 'custom_domain',
    type: 'varchar',
    length: 253,
    nullable: true,
  })
  customDomain!: string | null;
  @Column({
    name: 'domain_verification_status',
    type: 'varchar',
    length: 24,
    default: 'not_configured',
  })
  domainVerificationStatus!:
    | 'not_configured'
    | 'pending'
    | 'verified'
    | 'failed';
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('client_area_company_settings')
@Unique('UQ_client_area_company_settings_company', ['companyContextId'])
@Index('IDX_client_area_company_settings_scope', [
  'tenantId',
  'workspaceId',
  'agencyClientId',
])
export class ClientAreaCompanySettingsEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;
  @Column({ name: 'workspace_id', type: 'uuid' }) workspaceId!: string;
  @Column({ name: 'agency_client_id', type: 'uuid' }) agencyClientId!: string;
  @Column({ name: 'company_context_id', type: 'uuid' })
  companyContextId!: string;
  @Column({ type: 'boolean', default: false }) enabled!: boolean;
  @Column({ name: 'approvals_enabled', type: 'boolean', default: false })
  approvalsEnabled!: boolean;
  @Column({
    name: 'default_role',
    type: 'varchar',
    length: 24,
    default: 'client_viewer',
  })
  defaultRole!: ClientAreaRole;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

/** Audit only: preview never changes the simulated membership or client actor. */
@Entity('client_area_preview_events')
@Index('IDX_client_area_preview_events_scope', [
  'tenantId',
  'companyContextId',
  'createdAt',
])
export class ClientAreaPreviewEventEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;
  @Column({ name: 'workspace_id', type: 'uuid' }) workspaceId!: string;
  @Column({ name: 'agency_client_id', type: 'uuid' }) agencyClientId!: string;
  @Column({ name: 'company_context_id', type: 'uuid' })
  companyContextId!: string;
  @Column({ name: 'agency_actor_user_id', type: 'uuid' })
  agencyActorUserId!: string;
  @Column({ name: 'target_membership_id', type: 'uuid' })
  targetMembershipId!: string;
  @Column({ type: 'varchar', length: 24 }) action!:
    | 'preview_started'
    | 'preview_ended';
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
