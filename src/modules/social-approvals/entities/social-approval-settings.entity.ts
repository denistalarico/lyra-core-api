import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type SocialApprovalClientDecisionPolicy = 'first' | 'all';

/** AR1 — one row per context (D-18); no row means the safe defaults. */
@Entity('social_approval_settings')
@Index(
  'UQ_social_approval_settings_company',
  ['tenantId', 'workspaceId', 'agencyClientId', 'companyContextId'],
  { unique: true, where: '"agency_client_id" IS NOT NULL' },
)
@Index('UQ_social_approval_settings_own', ['tenantId', 'workspaceId'], {
  unique: true,
  where: '"agency_client_id" IS NULL',
})
export class SocialApprovalSettingsEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;
  @Column({ name: 'workspace_id', type: 'uuid' }) workspaceId!: string;
  @Column({ name: 'agency_client_id', type: 'uuid', nullable: true })
  agencyClientId!: string | null;
  @Column({ name: 'company_context_id', type: 'uuid', nullable: true })
  companyContextId!: string | null;
  @Column({
    name: 'internal_approval_enabled',
    type: 'boolean',
    default: true,
  })
  internalApprovalEnabled!: boolean;
  /** `user_id`, never `team_members.id` (D-17). */
  @Column({
    name: 'internal_approver_user_ids',
    type: 'jsonb',
    default: () => "'[]'::jsonb",
  })
  internalApproverUserIds!: string[];
  @Column({
    name: 'client_approver_membership_ids',
    type: 'jsonb',
    default: () => "'[]'::jsonb",
  })
  clientApproverMembershipIds!: string[];
  @Column({
    name: 'client_decision_policy',
    type: 'varchar',
    length: 8,
    default: 'first',
  })
  clientDecisionPolicy!: SocialApprovalClientDecisionPolicy;
  @Column({ name: 'client_can_edit_text', type: 'boolean', default: false })
  clientCanEditText!: boolean;
  @Column({ name: 'send_to_conversation', type: 'boolean', default: true })
  sendToConversation!: boolean;
  @Column({
    name: 'register_decisions_in_conversation',
    type: 'boolean',
    default: true,
  })
  registerDecisionsInConversation!: boolean;
  @Column({ name: 'team_chat_channel_id', type: 'uuid', nullable: true })
  teamChatChannelId!: string | null;
  @Column({
    name: 'notification_events',
    type: 'jsonb',
    default: () => "'{}'::jsonb",
  })
  notificationEvents!: Record<string, unknown>;
  @Column({ name: 'updated_by_user_id', type: 'uuid', nullable: true })
  updatedByUserId!: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
