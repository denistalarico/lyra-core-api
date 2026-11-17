import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

/** F4 (§4.3): IMAP cursor of the agency box, one row per workspace. */
@Entity('form_email_sync_state')
@Unique('uq_form_email_sync_state_workspace', ['tenantId', 'workspaceId'])
export class FormEmailSyncStateEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ type: 'varchar', length: 120, default: 'INBOX' })
  mailbox!: string;

  /** IMAP UIDVALIDITY (bigint) as text; a change restarts from the last 7 days. */
  @Column({ name: 'uid_validity', type: 'varchar', length: 40, nullable: true })
  uidValidity!: string | null;

  @Column({
    name: 'last_uid',
    type: 'bigint',
    default: 0,
    transformer: {
      to: (v: number) => v,
      from: (v: string | number) => Number(v),
    },
  })
  lastUid!: number;

  @Column({ name: 'last_polled_at', type: 'timestamptz', nullable: true })
  lastPolledAt!: Date | null;

  @Column({ name: 'last_success_at', type: 'timestamptz', nullable: true })
  lastSuccessAt!: Date | null;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
