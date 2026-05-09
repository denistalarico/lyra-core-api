import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type InboxParticipantType = 'contact' | 'user' | 'agent' | 'system';

@Entity('inbox_conversation_participants')
@Index('idx_inbox_participants_tenant_workspace', ['tenantId', 'workspaceId'])
@Index('idx_inbox_participants_conversation', ['conversationId'])
export class InboxConversationParticipantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'conversation_id', type: 'uuid' })
  conversationId!: string;

  @Column({ type: 'varchar', length: 32 })
  type!: InboxParticipantType;

  @Column({ name: 'contact_id', type: 'uuid', nullable: true })
  contactId!: string | null;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId!: string | null;

  @Column({ name: 'agent_id', type: 'uuid', nullable: true })
  agentId!: string | null;

  @Column({ name: 'display_name', type: 'varchar', length: 160, nullable: true })
  displayName!: string | null;

  @Column({ type: 'varchar', length: 40, default: 'member' })
  role!: string;

  @Column({ name: 'joined_at', type: 'timestamptz', nullable: true })
  joinedAt!: Date | null;

  @Column({ name: 'left_at', type: 'timestamptz', nullable: true })
  leftAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
