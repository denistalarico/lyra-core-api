import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import {
  TeamChatMessageKind,
  TeamChatMessageStatus,
} from '../enums';

@Entity('agency_chat_messages')
@Index(['tenantId', 'workspaceId'])
@Index(['channelId', 'createdAt'])
@Index(['meetingRoomId', 'createdAt'])
@Index(['senderUserId'])
export class AgencyChatMessage {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'channel_id', type: 'uuid', nullable: true })
  channelId!: string | null;

  @Column({ name: 'meeting_room_id', type: 'uuid', nullable: true })
  meetingRoomId!: string | null;

  @Column({ name: 'parent_message_id', type: 'uuid', nullable: true })
  parentMessageId!: string | null;

  @Column({ name: 'sender_user_id', type: 'uuid', nullable: true })
  senderUserId!: string | null;

  @Column({ name: 'sender_team_member_id', type: 'uuid', nullable: true })
  senderTeamMemberId!: string | null;

  @Column({ name: 'external_guest_id', type: 'uuid', nullable: true })
  externalGuestId!: string | null;

  @Column({ name: 'sender_display_name', type: 'varchar', length: 160, nullable: true })
  senderDisplayName!: string | null;

  @Column({
    type: 'enum',
    enum: TeamChatMessageKind,
    default: TeamChatMessageKind.TEXT,
  })
  kind!: TeamChatMessageKind;

  @Column({
    type: 'enum',
    enum: TeamChatMessageStatus,
    default: TeamChatMessageStatus.SENT,
  })
  status!: TeamChatMessageStatus;

  @Column({ type: 'text', nullable: true })
  body!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;

  @Column({ name: 'delivered_at', type: 'timestamptz', nullable: true })
  deliveredAt!: Date | null;

  @Column({ name: 'edited_at', type: 'timestamptz', nullable: true })
  editedAt!: Date | null;

  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
