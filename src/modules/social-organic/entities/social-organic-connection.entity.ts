import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { SocialOrganicAssetEntity } from './social-organic-asset.entity';

export type SocialOrganicConnectionStatus =
  | 'pending'
  | 'awaiting_selection'
  | 'connected'
  | 'error'
  | 'disconnected';

export type SocialOrganicAuthorizationMethod =
  | 'oauth_user'
  | 'oauth_business'
  | 'internal_system_user';

/** One provider authorization. Publishable identities live in the asset table. */
@Entity('social_organic_connections')
@Index('IDX_social_organic_connections_context', [
  'tenantId',
  'workspaceId',
  'agencyClientId',
])
@Index('IDX_social_organic_connections_oauth_state', ['oauthStateHash'])
export class SocialOrganicConnectionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  /** NULL means the agency's own context; otherwise this is a managed client. */
  @Column({ name: 'agency_client_id', type: 'uuid', nullable: true })
  agencyClientId!: string | null;

  /** Kept open-ended so adding a provider never requires a schema migration. */
  @Column({ type: 'varchar', length: 40 })
  provider!: string;

  @Column({
    name: 'connection_status',
    type: 'varchar',
    length: 32,
    default: 'pending',
  })
  connectionStatus!: SocialOrganicConnectionStatus;

  @Column({ name: 'authorization_method', type: 'varchar', length: 40 })
  authorizationMethod!: SocialOrganicAuthorizationMethod;

  @Column({ name: 'credential_version', type: 'integer', default: 1 })
  credentialVersion!: number;

  @Column({
    name: 'access_token_encrypted',
    type: 'text',
    nullable: true,
    select: false,
  })
  accessTokenEncrypted!: string | null;

  @Column({
    name: 'refresh_token_encrypted',
    type: 'text',
    nullable: true,
    select: false,
  })
  refreshTokenEncrypted!: string | null;

  @Column({ name: 'token_expires_at', type: 'timestamptz', nullable: true })
  tokenExpiresAt!: Date | null;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  scopes!: string[];

  @Column({
    name: 'oauth_state_hash',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  oauthStateHash!: string | null;

  @Column({ name: 'oauth_expires_at', type: 'timestamptz', nullable: true })
  oauthExpiresAt!: Date | null;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById!: string | null;

  /** Safe error code only; never persist raw provider error messages here. */
  @Column({ name: 'last_error', type: 'varchar', length: 240, nullable: true })
  lastError!: string | null;

  /** Non-secret provider context. Tokens belong only in encrypted columns. */
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @Column({
    name: 'credential_removed_at',
    type: 'timestamptz',
    nullable: true,
  })
  credentialRemovedAt!: Date | null;

  @OneToMany(() => SocialOrganicAssetEntity, (asset) => asset.connection)
  assets!: SocialOrganicAssetEntity[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
