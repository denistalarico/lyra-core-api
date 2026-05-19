import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

export type AgencyWorkspaceRole = 'owner' | 'admin' | 'manager' | 'member';
export type AgencyWorkspaceUserStatus = 'active' | 'invited' | 'inactive';
export type AgencyPermissionAccess = 'full' | 'partial' | 'blocked';

@Entity('user_preferences')
@Unique('uq_agency_user_preferences_tenant_user', ['tenantId', 'userId'])
@Index('idx_agency_user_preferences_tenant_user', ['tenantId', 'userId'])
export class AgencyUserPreferencesEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({
    name: 'theme_preference',
    type: 'varchar',
    length: 20,
    default: 'system',
  })
  themePreference!: 'light' | 'dark' | 'system';

  @Column({ type: 'varchar', length: 10, default: 'pt-BR' })
  locale!: 'pt-BR' | 'en' | 'es';

  @Column({ type: 'varchar', length: 80, default: 'America/Sao_Paulo' })
  timezone!: string;

  @Column({
    name: 'date_format',
    type: 'varchar',
    length: 20,
    default: 'dd/MM/yyyy',
  })
  dateFormat!: string;

  @Column({ name: 'time_format', type: 'varchar', length: 10, default: '24h' })
  timeFormat!: '12h' | '24h';

  @Column({ name: 'sidebar_collapsed', type: 'boolean', default: false })
  sidebarCollapsed!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('user_profile')
@Unique('uq_agency_user_profile_tenant_user', ['tenantId', 'userId'])
@Index('idx_agency_user_profile_tenant_user', ['tenantId', 'userId'])
export class AgencyUserProfileEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'display_name', type: 'varchar', length: 120, default: '' })
  displayName!: string;

  @Column({ type: 'varchar', length: 160, default: '' })
  email!: string;

  @Column({ type: 'varchar', length: 40, nullable: true })
  phone!: string | null;

  @Column({ name: 'job_title', type: 'varchar', length: 80, nullable: true })
  jobTitle!: string | null;

  @Column({ name: 'avatar_url', type: 'text', nullable: true })
  avatarUrl!: string | null;

  @Column({ name: 'avatar_path', type: 'varchar', length: 255, nullable: true })
  avatarPath!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('workspace_company_settings')
@Unique('uq_agency_workspace_company_tenant_workspace', [
  'tenantId',
  'workspaceId',
])
@Index('idx_agency_workspace_company_tenant_workspace', [
  'tenantId',
  'workspaceId',
])
export class AgencyWorkspaceCompanySettingsEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'legal_name', type: 'varchar', length: 120, default: '' })
  legalName!: string;

  @Column({ name: 'trade_name', type: 'varchar', length: 80, default: '' })
  tradeName!: string;

  @Column({ name: 'workspace_name', type: 'varchar', length: 80, default: '' })
  workspaceName!: string;

  @Column({ name: 'tax_id_type', type: 'varchar', length: 20, default: 'CNPJ' })
  taxIdType!: string;

  @Column({ name: 'tax_id', type: 'varchar', length: 40, default: '' })
  taxId!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  website!: string | null;

  @Column({
    name: 'support_email',
    type: 'varchar',
    length: 160,
    nullable: true,
  })
  supportEmail!: string | null;

  @Column({
    name: 'billing_email',
    type: 'varchar',
    length: 160,
    nullable: true,
  })
  billingEmail!: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  phone!: string | null;

  @Column({ type: 'varchar', length: 80, default: 'BR' })
  country!: string;

  @Column({ type: 'varchar', length: 10, default: 'BRL' })
  currency!: string;

  @Column({
    name: 'default_locale',
    type: 'varchar',
    length: 10,
    default: 'pt-BR',
  })
  defaultLocale!: string;

  @Column({ type: 'varchar', length: 80, default: 'America/Sao_Paulo' })
  timezone!: string;

  @Column({
    name: 'address_line',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  addressLine!: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  industry!: string | null;

  @Column({ name: 'company_size', type: 'varchar', length: 40, nullable: true })
  companySize!: string | null;

  @Column({ name: 'avatar_url', type: 'text', nullable: true })
  avatarUrl!: string | null;

  @Column({ name: 'avatar_path', type: 'varchar', length: 255, nullable: true })
  avatarPath!: string | null;

  @Column({ name: 'logo_url', type: 'text', nullable: true })
  logoUrl!: string | null;

  @Column({ name: 'logo_path', type: 'varchar', length: 255, nullable: true })
  logoPath!: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('workspace_notification_settings')
@Unique('uq_agency_workspace_notification_tenant_workspace', [
  'tenantId',
  'workspaceId',
])
@Index('idx_agency_workspace_notification_tenant_workspace', [
  'tenantId',
  'workspaceId',
])
export class AgencyWorkspaceNotificationSettingsEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'quiet_hours_enabled', type: 'boolean', default: true })
  quietHoursEnabled!: boolean;

  @Column({ name: 'quiet_hours', type: 'jsonb', default: () => "'[]'::jsonb" })
  quietHours!: Array<Record<string, unknown>>;

  @Column({ name: 'history_limit', type: 'int', default: 10 })
  historyLimit!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('user_notification_preferences')
@Unique('uq_agency_user_notification_preferences_tenant_user', [
  'tenantId',
  'userId',
])
@Index('idx_agency_user_notification_preferences_tenant_user', [
  'tenantId',
  'userId',
])
export class AgencyUserNotificationPreferencesEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  preferences!: Array<Record<string, unknown>>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('workspace_security_settings')
@Unique('uq_agency_workspace_security_tenant_workspace', [
  'tenantId',
  'workspaceId',
])
@Index('idx_agency_workspace_security_tenant_workspace', [
  'tenantId',
  'workspaceId',
])
export class AgencyWorkspaceSecuritySettingsEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'login_alerts_enabled', type: 'boolean', default: true })
  loginAlertsEnabled!: boolean;

  @Column({ name: 'trusted_devices_enabled', type: 'boolean', default: true })
  trustedDevicesEnabled!: boolean;

  @Column({ name: 'two_factor_required', type: 'boolean', default: false })
  twoFactorRequired!: boolean;

  @Column({ name: 'password_min_length', type: 'int', default: 8 })
  passwordMinLength!: number;

  @Column({
    name: 'email_domain',
    type: 'varchar',
    length: 120,
    default: 'lyrasuite.com',
  })
  emailDomain!: string;

  @Column({
    name: 'email_templates',
    type: 'jsonb',
    default: () => "'{}'::jsonb",
  })
  emailTemplates!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('workspace_email_settings')
@Unique('uq_agency_workspace_email_tenant_workspace', [
  'tenantId',
  'workspaceId',
])
@Index('idx_agency_workspace_email_tenant_workspace', [
  'tenantId',
  'workspaceId',
])
export class AgencyWorkspaceEmailSettingsEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ type: 'varchar', length: 40, default: 'smtp_imap' })
  provider!: string;

  @Column({ name: 'from_name', type: 'varchar', length: 120, default: '' })
  fromName!: string;

  @Column({ name: 'from_email', type: 'varchar', length: 160, nullable: true })
  fromEmail!: string | null;

  @Column({
    name: 'reply_to_email',
    type: 'varchar',
    length: 160,
    nullable: true,
  })
  replyToEmail!: string | null;

  @Column({ name: 'smtp_host', type: 'varchar', length: 160, nullable: true })
  smtpHost!: string | null;

  @Column({ name: 'smtp_port', type: 'int', nullable: true })
  smtpPort!: number | null;

  @Column({ name: 'smtp_secure', type: 'boolean', default: true })
  smtpSecure!: boolean;

  @Column({ name: 'smtp_user', type: 'varchar', length: 160, nullable: true })
  smtpUser!: string | null;

  @Column({ name: 'smtp_password_encrypted', type: 'text', nullable: true })
  smtpPasswordEncrypted!: string | null;

  @Column({ name: 'imap_host', type: 'varchar', length: 160, nullable: true })
  imapHost!: string | null;

  @Column({ name: 'imap_port', type: 'int', nullable: true })
  imapPort!: number | null;

  @Column({ name: 'imap_secure', type: 'boolean', default: true })
  imapSecure!: boolean;

  @Column({ name: 'imap_user', type: 'varchar', length: 160, nullable: true })
  imapUser!: string | null;

  @Column({ name: 'imap_password_encrypted', type: 'text', nullable: true })
  imapPasswordEncrypted!: string | null;

  @Column({ type: 'varchar', length: 30, default: 'not_configured' })
  status!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('workspace_apps_settings')
@Unique('uq_agency_workspace_apps_tenant_workspace', [
  'tenantId',
  'workspaceId',
])
@Index('idx_agency_workspace_apps_tenant_workspace', [
  'tenantId',
  'workspaceId',
])
export class AgencyWorkspaceAppsSettingsEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  apps!: Array<Record<string, unknown>>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('workspace_finance_settings')
@Unique('uq_agency_workspace_finance_tenant_workspace', [
  'tenantId',
  'workspaceId',
])
@Index('idx_agency_workspace_finance_tenant_workspace', [
  'tenantId',
  'workspaceId',
])
export class AgencyWorkspaceFinanceSettingsEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ type: 'varchar', length: 10, default: 'BRL' })
  currency!: string;

  @Column({ type: 'varchar', length: 80, default: 'BR' })
  country!: string;

  @Column({ name: 'settings', type: 'jsonb', default: () => "'{}'::jsonb" })
  settings!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('workspace_subscription_settings')
@Unique('uq_agency_workspace_subscription_tenant_workspace', [
  'tenantId',
  'workspaceId',
])
@Index('idx_agency_workspace_subscription_tenant_workspace', [
  'tenantId',
  'workspaceId',
])
export class AgencyWorkspaceSubscriptionSettingsEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({
    name: 'plan_key',
    type: 'varchar',
    length: 40,
    default: 'agency_starter',
  })
  planKey!: string;

  @Column({ type: 'varchar', length: 30, default: 'active' })
  status!: string;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  limits!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('workspace_advanced_settings')
@Unique('uq_agency_workspace_advanced_tenant_workspace', [
  'tenantId',
  'workspaceId',
])
@Index('idx_agency_workspace_advanced_tenant_workspace', [
  'tenantId',
  'workspaceId',
])
export class AgencyWorkspaceAdvancedSettingsEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'developer_mode', type: 'boolean', default: false })
  developerMode!: boolean;

  @Column({ name: 'api_access_enabled', type: 'boolean', default: false })
  apiAccessEnabled!: boolean;

  @Column({ name: 'webhooks_enabled', type: 'boolean', default: false })
  webhooksEnabled!: boolean;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  settings!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('workspace_integrations')
@Unique('uq_agency_workspace_integrations_workspace_item', [
  'workspaceId',
  'itemId',
])
@Index('idx_agency_workspace_integrations_tenant_workspace', [
  'tenantId',
  'workspaceId',
])
export class AgencyWorkspaceIntegrationEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'item_id', type: 'varchar', length: 80 })
  itemId!: string;

  @Column({ type: 'varchar', length: 30, default: 'integration' })
  category!: 'integration' | 'app';

  @Column({ type: 'varchar', length: 30, default: 'available' })
  status!: 'available' | 'connected' | 'coming_soon' | 'requires_setup';

  @Column({ name: 'is_installed', type: 'boolean', default: false })
  isInstalled!: boolean;

  @Column({ name: 'is_pinned', type: 'boolean', default: false })
  isPinned!: boolean;

  @Column({ name: 'sidebar_order', type: 'int', nullable: true })
  sidebarOrder!: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('workspace_users')
@Unique('uq_agency_workspace_users_workspace_email', ['workspaceId', 'email'])
@Index('idx_agency_workspace_users_tenant_workspace', [
  'tenantId',
  'workspaceId',
])
export class AgencyWorkspaceUserEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId!: string | null;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Column({ type: 'varchar', length: 160 })
  email!: string;

  @Column({ type: 'varchar', length: 20 })
  role!: AgencyWorkspaceRole;

  @Column({ type: 'varchar', length: 20 })
  status!: AgencyWorkspaceUserStatus;

  @Column({ name: 'last_access', type: 'varchar', length: 120, default: '' })
  lastAccess!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('workspace_user_permissions')
@Unique('uq_agency_workspace_user_permissions_user_app', [
  'workspaceUserId',
  'appKey',
])
@Index('idx_agency_workspace_user_permissions_user', ['workspaceUserId'])
export class AgencyWorkspaceUserPermissionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'workspace_user_id', type: 'uuid' })
  workspaceUserId!: string;

  @Column({ name: 'app_key', type: 'varchar', length: 40 })
  appKey!: string;

  @Column({ type: 'varchar', length: 20, default: 'blocked' })
  access!: AgencyPermissionAccess;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
