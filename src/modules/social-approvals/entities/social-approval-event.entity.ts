import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { SocialApprovalActorType } from './social-approval-stage-decision.entity';

export const SOCIAL_APPROVAL_EVENT_TYPES = [
  'sent',
  'internal_skipped',
  'viewed',
  'commented',
  'approved',
  'changes_requested',
  'agency_override',
  'edited',
  'superseded',
  'cancelled',
  'finished',
  'reopened_stale',
] as const;
export type SocialApprovalEventType =
  (typeof SOCIAL_APPROVAL_EVENT_TYPES)[number];

export const SOCIAL_APPROVAL_SURFACES = [
  'agency',
  'client_area',
  'self',
  'team_chat',
  'client_conversation',
  'projects',
  'planner',
  'system',
] as const;
export type SocialApprovalSurface = (typeof SOCIAL_APPROVAL_SURFACES)[number];

/**
 * AR1 — append-only trail (D-16). `actor_name` is captured at write time so
 * the history survives removing a member. Comments and decisions stay in
 * their own tables; an event only points at them.
 */
@Entity('social_approval_events')
@Index('IDX_social_approval_events_piece', ['pieceId', 'createdAt'])
export class SocialApprovalEventEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;
  @Column({ name: 'workspace_id', type: 'uuid' }) workspaceId!: string;
  @Column({ name: 'agency_client_id', type: 'uuid', nullable: true })
  agencyClientId!: string | null;
  @Column({ name: 'company_context_id', type: 'uuid', nullable: true })
  companyContextId!: string | null;
  @Column({ name: 'piece_id', type: 'uuid' }) pieceId!: string;
  @Column({ name: 'step_id', type: 'uuid', nullable: true })
  stepId!: string | null;
  @Column({ name: 'request_id', type: 'uuid', nullable: true })
  requestId!: string | null;
  @Column({ type: 'varchar', length: 24 }) type!: SocialApprovalEventType;
  @Column({ name: 'actor_type', type: 'varchar', length: 16 })
  actorType!: SocialApprovalActorType;
  @Column({ name: 'actor_user_id', type: 'uuid', nullable: true })
  actorUserId!: string | null;
  @Column({ name: 'actor_name', type: 'varchar', length: 160, nullable: true })
  actorName!: string | null;
  @Column({ type: 'varchar', length: 24 }) surface!: SocialApprovalSurface;
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
