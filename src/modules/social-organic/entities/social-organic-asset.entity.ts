import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { SocialOrganicConnectionEntity } from './social-organic-connection.entity';

export type SocialOrganicAssetStatus =
  | 'active'
  | 'permission_lost'
  | 'revoked'
  | 'archived';

/** A publishable identity discovered through an organic authorization. */
@Entity('social_organic_assets')
@Unique('UQ_social_organic_assets_external_asset', [
  'tenantId',
  'workspaceId',
  'provider',
  'externalAssetId',
])
@Index('IDX_social_organic_assets_context', [
  'tenantId',
  'workspaceId',
  'agencyClientId',
])
@Index('IDX_social_organic_assets_connection', ['connectionId'])
export class SocialOrganicAssetEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  /** NULL means the agency's own context; otherwise this is a managed client. */
  @Column({ name: 'agency_client_id', type: 'uuid', nullable: true })
  agencyClientId!: string | null;

  @Column({ name: 'connection_id', type: 'uuid' })
  connectionId!: string;

  @ManyToOne(
    () => SocialOrganicConnectionEntity,
    (connection) => connection.assets,
    { onDelete: 'RESTRICT' },
  )
  @JoinColumn({
    name: 'connection_id',
    foreignKeyConstraintName: 'FK_social_organic_assets_connection',
  })
  connection!: SocialOrganicConnectionEntity;

  /** Kept open-ended so adding a provider never requires a schema migration. */
  @Column({ type: 'varchar', length: 40 })
  provider!: string;

  /** Provider-neutral varchar: capability adapters own the concrete values. */
  @Column({ name: 'asset_type', type: 'varchar', length: 64 })
  assetType!: string;

  @Column({ name: 'external_asset_id', type: 'varchar', length: 180 })
  externalAssetId!: string;

  @Column({
    name: 'display_name',
    type: 'varchar',
    length: 240,
    nullable: true,
  })
  displayName!: string | null;

  @Column({ type: 'varchar', length: 180, nullable: true })
  username!: string | null;

  @Column({ name: 'avatar_url', type: 'text', nullable: true })
  avatarUrl!: string | null;

  @Column({
    name: 'asset_token_encrypted',
    type: 'text',
    nullable: true,
    select: false,
  })
  assetTokenEncrypted!: string | null;

  @Column({
    name: 'asset_token_expires_at',
    type: 'timestamptz',
    nullable: true,
  })
  assetTokenExpiresAt!: Date | null;

  /**
   * Provider-confirmed IANA timezone used for analytics day boundaries.
   *
   * Nullable for assets created before A1.1 and providers that expose no
   * canonical timezone. Analytics must fail closed while this is NULL; it must
   * never fall back to the server, tenant, workspace or an offset.
   */
  @Column({
    name: 'asset_timezone',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  assetTimezone!: string | null;

  @Column({ name: 'is_publish_enabled', type: 'boolean', default: false })
  isPublishEnabled!: boolean;

  @Column({
    name: 'capabilities_snapshot',
    type: 'jsonb',
    default: () => "'{}'::jsonb",
  })
  capabilitiesSnapshot!: Record<string, unknown>;

  @Column({ type: 'varchar', length: 32, default: 'active' })
  status!: SocialOrganicAssetStatus;

  @Column({
    name: 'last_health_check_at',
    type: 'timestamptz',
    nullable: true,
  })
  lastHealthCheckAt!: Date | null;

  @Column({
    name: 'last_health_status',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  lastHealthStatus!: string | null;

  /** Non-secret provider context. Tokens belong only in encrypted columns. */
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
