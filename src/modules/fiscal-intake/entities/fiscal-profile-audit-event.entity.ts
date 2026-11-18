import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type FiscalAuditAction =
  | 'intake_link_created'
  | 'intake_link_revoked'
  | 'intake_submitted'
  | 'certificate_uploaded'
  | 'intake_approved'
  | 'intake_rejected'
  | 'certificate_replaced'
  | 'certificate_decrypted';

/** §8.4: upload, replacement, approval and every decryption leave a row. */
@Entity('fiscal_profile_audit_events')
export class FiscalProfileAuditEventEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ type: 'varchar', length: 60 })
  action!: FiscalAuditAction;

  @Column({ name: 'actor_kind', type: 'varchar', length: 20 })
  actorKind!: 'user' | 'accountant' | 'system';

  @Column({ name: 'actor_user_id', type: 'uuid', nullable: true })
  actorUserId!: string | null;

  @Column({ name: 'intake_request_id', type: 'uuid', nullable: true })
  intakeRequestId!: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  details!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
