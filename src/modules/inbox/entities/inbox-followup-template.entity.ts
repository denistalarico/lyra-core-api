import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { InboxScopeKind } from '../inbox-company-scope';

/** Which follow-up attempt a template is written for; `any` fits all four. */
export const INBOX_FOLLOWUP_TEMPLATE_STEP_KEYS = [
  'd0',
  'd1',
  'd3',
  'd7',
  'any',
] as const;

export type InboxFollowupTemplateStepKey =
  (typeof INBOX_FOLLOWUP_TEMPLATE_STEP_KEYS)[number];

/**
 * A Lyra follow-up template (IX2, D-IX-9): the words a person sends with one
 * click when a follow-up step is waiting for them. Not a Meta template — on
 * Instagram/Messenger no such thing exists; these are Lyra's own texts, sent
 * as a person with the `HUMAN_AGENT` tag when past 24 hours.
 *
 * Its own table rather than a flavour of `inbox_settings.quick_replies`: the
 * quick replies are composer snippets whose array is replaced whole by the
 * settings PATCH and exported/imported as CSV, and none of that carries a step
 * or a channel. The scope columns are the same as `inbox_settings`.
 */
@Entity('inbox_followup_templates')
@Index('idx_inbox_followup_templates_scope', [
  'tenantId',
  'workspaceId',
  'agencyClientId',
  'companyContextId',
  'sortOrder',
])
export class InboxFollowupTemplateEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'agency_client_id', type: 'uuid', nullable: true })
  agencyClientId!: string | null;

  @Column({ name: 'company_context_id', type: 'uuid', nullable: true })
  companyContextId!: string | null;

  @Column({ name: 'scope_kind', type: 'varchar', length: 24 })
  scopeKind!: InboxScopeKind;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Column({ name: 'step_key', type: 'varchar', length: 8 })
  stepKey!: InboxFollowupTemplateStepKey;

  /** Inbox channel types (`instagram`, `facebook_messenger`); empty = all. */
  @Column({
    name: 'channel_types',
    type: 'jsonb',
    default: () => "'[]'::jsonb",
  })
  channelTypes!: string[];

  /** Text with `{{namespace.field}}` variables, rendered at send time. */
  @Column({ type: 'text' })
  body!: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
