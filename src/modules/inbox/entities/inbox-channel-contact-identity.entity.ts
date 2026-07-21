import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('inbox_channel_contact_identities')
@Index(
  'uq_inbox_channel_contact_identity',
  ['tenantId', 'workspaceId', 'channelId', 'externalIdentityHash'],
  { unique: true },
)
export class InboxChannelContactIdentityEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;
  @Column({ name: 'workspace_id', type: 'uuid' }) workspaceId!: string;
  @Column({ name: 'channel_id', type: 'uuid' }) channelId!: string;
  @Column({ name: 'contact_id', type: 'uuid' }) contactId!: string;
  @Column({ name: 'external_identity_hash', type: 'char', length: 64 })
  externalIdentityHash!: string;
  @Column({ name: 'identity_type', type: 'varchar', length: 32 })
  identityType!: string;
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  provenance!: Record<string, unknown>;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
