import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import {
  TeamChatMemberRole,
  TeamChatNotificationLevel,
} from '../enums';

@Entity('agency_chat_channel_members')
@Index(['tenantId', 'workspaceId'])
@Index(['channelId'])
@Index(['tenantId', 'workspaceId', 'userId'])
export class AgencyChatChannelMember {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'channel_id', type: 'uuid' })
  channelId!: string;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId!: string | null;

  @Column({ name: 'team_member_id', type: 'uuid', nullable: true })
  teamMemberId!: string | null;

  @Column({ name: 'display_name', type: 'varchar', length: 160, nullable: true })
  displayName!: string | null;

  @Column({
    type: 'enum',
    enum: TeamChatMemberRole,
    default: TeamChatMemberRole.MEMBER,
  })
  role!: TeamChatMemberRole;

  @Column({
    name: 'notification_level',
    type: 'enum',
    enum: TeamChatNotificationLevel,
    default: TeamChatNotificationLevel.ALL,
  })
  notificationLevel!: TeamChatNotificationLevel;

  @Column({ name: 'last_read_message_id', type: 'uuid', nullable: true })
  lastReadMessageId!: string | null;

  @Column({ name: 'last_read_at', type: 'timestamptz', nullable: true })
  lastReadAt!: Date | null;

  @Column({ name: 'joined_at', type: 'timestamptz', nullable: true })
  joinedAt!: Date | null;

  @Column({ name: 'left_at', type: 'timestamptz', nullable: true })
  leftAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
