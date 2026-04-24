import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

@Entity('workspace_settings_email')
@Unique('uq_workspace_settings_email_tenant_workspace', [
  'tenantId',
  'workspaceId',
])
@Index('idx_workspace_settings_email_tenant_workspace', [
  'tenantId',
  'workspaceId',
])
export class WorkspaceSettingsEmailEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({
    name: 'notification_email',
    type: 'varchar',
    length: 160,
    default: '',
  })
  notificationEmail!: string;

  @Column({ name: 'incoming_host', type: 'varchar', length: 255, default: '' })
  incomingHost!: string;

  @Column({ name: 'incoming_port', type: 'varchar', length: 10, default: '' })
  incomingPort!: string;

  @Column({
    name: 'incoming_username',
    type: 'varchar',
    length: 160,
    default: '',
  })
  incomingUsername!: string;

  @Column({ name: 'incoming_password_encrypted', type: 'text', nullable: true })
  incomingPasswordEncrypted!: string | null;

  @Column({
    name: 'incoming_security',
    type: 'varchar',
    length: 20,
    default: 'ssl_tls',
  })
  incomingSecurity!: 'none' | 'ssl_tls' | 'starttls';

  @Column({
    name: 'incoming_server_type',
    type: 'varchar',
    length: 20,
    default: 'imap',
  })
  incomingServerType!: 'imap' | 'pop' | 'local';

  @Column({ name: 'outgoing_host', type: 'varchar', length: 255, default: '' })
  outgoingHost!: string;

  @Column({ name: 'outgoing_port', type: 'varchar', length: 10, default: '' })
  outgoingPort!: string;

  @Column({
    name: 'outgoing_username',
    type: 'varchar',
    length: 160,
    default: '',
  })
  outgoingUsername!: string;

  @Column({ name: 'outgoing_password_encrypted', type: 'text', nullable: true })
  outgoingPasswordEncrypted!: string | null;

  @Column({
    name: 'outgoing_security',
    type: 'varchar',
    length: 20,
    default: 'starttls',
  })
  outgoingSecurity!: 'none' | 'ssl_tls' | 'starttls';

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
