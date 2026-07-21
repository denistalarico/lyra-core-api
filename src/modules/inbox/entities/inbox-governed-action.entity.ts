import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type {
  InboxGovernedActionType,
  InboxGovernedPolicyOutcome,
} from '../runtime/inbox-governed-autonomy-policy.service';

export type InboxGovernedActionStatus =
  | 'planned'
  | 'blocked'
  | 'requires_human'
  | 'stale'
  | 'invalid'
  | 'claimed'
  | 'applied'
  | 'failed'
  | 'unknown_outcome';

@Entity('inbox_governed_actions')
@Index('idx_inbox_governed_action_scope_status', [
  'tenantId',
  'workspaceId',
  'status',
  'createdAt',
])
@Index(
  'uq_inbox_governed_action_idempotency',
  ['tenantId', 'workspaceId', 'idempotencyKey'],
  { unique: true },
)
export class InboxGovernedActionEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;
  @Column({ name: 'workspace_id', type: 'uuid' }) workspaceId!: string;
  @Column({ name: 'conversation_id', type: 'uuid' }) conversationId!: string;
  @Column({ name: 'decision_id', type: 'uuid' }) decisionId!: string;
  @Column({ name: 'ownership_version', type: 'int' }) ownershipVersion!: number;
  @Column({ name: 'policy_version', type: 'varchar', length: 80 })
  policyVersion!: string;
  @Column({ name: 'action_type', type: 'varchar', length: 40 })
  actionType!: InboxGovernedActionType;
  @Column({ name: 'action_key', type: 'varchar', length: 180 })
  actionKey!: string;
  @Column({ name: 'policy_outcome', type: 'varchar', length: 24 })
  policyOutcome!: InboxGovernedPolicyOutcome;
  @Column({ name: 'reason_code', type: 'varchar', length: 80 })
  reasonCode!: string;
  @Column({ name: 'idempotency_key', type: 'varchar', length: 220 })
  idempotencyKey!: string;
  @Column({ name: 'intent_hash', type: 'char', length: 64 })
  intentHash!: string;
  @Column({ name: 'audit_ref', type: 'uuid' }) auditRef!: string;
  @Column({ type: 'varchar', length: 24 }) status!: InboxGovernedActionStatus;
  @Column({
    name: 'canonical_refs',
    type: 'jsonb',
    default: () => "'[]'::jsonb",
  })
  canonicalRefs!: string[];
  @Column({
    name: 'application_result',
    type: 'jsonb',
    default: () => "'{}'::jsonb",
  })
  applicationResult!: Record<string, unknown>;
  @Column({ type: 'int', default: 0 }) attempts!: number;
  @Column({ name: 'claimed_at', type: 'timestamptz', nullable: true })
  claimedAt!: Date | null;
  @Column({ name: 'claimed_by', type: 'varchar', length: 100, nullable: true })
  claimedBy!: string | null;
  @Column({ name: 'applied_at', type: 'timestamptz', nullable: true })
  appliedAt!: Date | null;
  @Column({ name: 'failed_at', type: 'timestamptz', nullable: true })
  failedAt!: Date | null;
  @Column({ name: 'error_code', type: 'varchar', length: 80, nullable: true })
  errorCode!: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
