import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { SocialAdEntityLevel } from '../../social-integrations/entities';

export type SocialAdManualActionType =
  | 'set_status'
  | 'set_budget'
  | 'set_end_time'
  | 'delete';

export type SocialAdManualActionStatus =
  | 'pending_confirmation'
  | 'executing'
  | 'verified'
  | 'succeeded_unverified'
  | 'blocked'
  | 'failed'
  | 'expired';

/** Immutable intent plus sanitized execution evidence for one manual write. */
@Entity('social_ad_governed_actions')
@Index('UQ_social_ad_governed_actions_request', ['requestId'], { unique: true })
@Index('IDX_social_ad_governed_actions_scope', [
  'tenantId',
  'workspaceId',
  'agencyClientId',
  'connectionId',
  'createdAt',
])
@Check(
  'CK_social_ad_governed_action_type',
  `"action_type" IN ('set_status', 'set_budget', 'set_end_time', 'delete')`,
)
@Check(
  'CK_social_ad_governed_action_status',
  `"status" IN ('pending_confirmation', 'executing', 'verified', 'succeeded_unverified', 'blocked', 'failed', 'expired')`,
)
export class SocialAdGovernedActionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'agency_client_id', type: 'uuid', nullable: true })
  agencyClientId!: string | null;

  @Column({ name: 'connection_id', type: 'uuid' })
  connectionId!: string;

  @Column({ name: 'entity_level', type: 'varchar', length: 20 })
  entityLevel!: Exclude<SocialAdEntityLevel, 'account'>;

  @Column({ name: 'entity_external_id', type: 'varchar', length: 180 })
  entityExternalId!: string;

  @Column({ name: 'entity_name', type: 'text', nullable: true })
  entityName!: string | null;

  @Column({ name: 'action_type', type: 'varchar', length: 30 })
  actionType!: SocialAdManualActionType;

  @Column({ type: 'varchar', length: 30 })
  status!: SocialAdManualActionStatus;

  @Column({ name: 'request_id', type: 'uuid' })
  requestId!: string;

  @Column({ name: 'confirmation_request_id', type: 'uuid', nullable: true })
  confirmationRequestId!: string | null;

  @Column({ name: 'before_snapshot', type: 'jsonb' })
  beforeSnapshot!: Record<string, unknown>;

  @Column({ name: 'requested_change', type: 'jsonb' })
  requestedChange!: Record<string, unknown>;

  @Column({ name: 'provider_result', type: 'jsonb', nullable: true })
  providerResult!: Record<string, unknown> | null;

  @Column({
    name: 'confirmation_phrase',
    type: 'varchar',
    length: 240,
    nullable: true,
  })
  confirmationPhrase!: string | null;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'proposed_by_id', type: 'uuid', nullable: true })
  proposedById!: string | null;

  @Column({ name: 'confirmed_by_id', type: 'uuid', nullable: true })
  confirmedById!: string | null;

  @Column({ name: 'error_code', type: 'varchar', length: 120, nullable: true })
  errorCode!: string | null;

  @Column({ name: 'executed_at', type: 'timestamptz', nullable: true })
  executedAt!: Date | null;

  @Column({ name: 'verified_at', type: 'timestamptz', nullable: true })
  verifiedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
