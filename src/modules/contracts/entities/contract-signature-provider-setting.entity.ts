import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import {
  ContractSignatureMode,
  ContractSignatureProvider,
} from '../enums';

@Entity('agency_contract_signature_provider_settings')
export class ContractSignatureProviderSetting {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ type: 'varchar', length: 40 })
  provider!: ContractSignatureProvider;

  @Column({ type: 'varchar', length: 40, default: 'inactive' })
  status!: 'active' | 'inactive';

  @Column({ name: 'api_base_url', type: 'varchar', length: 255, nullable: true })
  apiBaseUrl!: string | null;

  @Column({ name: 'api_token_encrypted', type: 'text', nullable: true })
  apiTokenEncrypted!: string | null;

  @Column({ name: 'webhook_secret_encrypted', type: 'text', nullable: true })
  webhookSecretEncrypted!: string | null;

  @Column({
    name: 'default_signature_mode',
    type: 'varchar',
    length: 40,
    default: ContractSignatureMode.Digital,
  })
  defaultSignatureMode!: ContractSignatureMode;

  @Column({ name: 'sandbox_enabled', type: 'boolean', default: false })
  sandboxEnabled!: boolean;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById!: string | null;

  @Column({ name: 'updated_by_id', type: 'uuid', nullable: true })
  updatedById!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
