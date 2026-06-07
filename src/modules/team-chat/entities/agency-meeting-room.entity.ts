import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import {
  TeamChatMeetingAccessMode,
  TeamChatMeetingProvider,
  TeamChatMeetingStatus,
} from '../enums';

@Entity('agency_meeting_rooms')
@Index(['tenantId', 'workspaceId'])
@Index(['tenantId', 'workspaceId', 'status'])
@Index(['publicSlug'], { unique: true })
export class AgencyMeetingRoom {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ type: 'varchar', length: 180 })
  title!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({
    type: 'enum',
    enum: TeamChatMeetingStatus,
    default: TeamChatMeetingStatus.SCHEDULED,
  })
  status!: TeamChatMeetingStatus;

  @Column({
    name: 'access_mode',
    type: 'enum',
    enum: TeamChatMeetingAccessMode,
    default: TeamChatMeetingAccessMode.PUBLIC_LINK,
  })
  accessMode!: TeamChatMeetingAccessMode;

  @Column({
    type: 'enum',
    enum: TeamChatMeetingProvider,
    default: TeamChatMeetingProvider.LIVEKIT,
  })
  provider!: TeamChatMeetingProvider;

  @Column({ name: 'provider_room_name', type: 'varchar', length: 220, nullable: true })
  providerRoomName!: string | null;

  @Column({ name: 'public_slug', type: 'varchar', length: 120 })
  publicSlug!: string;

  @Column({ name: 'channel_id', type: 'uuid', nullable: true })
  channelId!: string | null;

  @Column({ name: 'related_client_id', type: 'uuid', nullable: true })
  relatedClientId!: string | null;

  @Column({ name: 'related_project_id', type: 'uuid', nullable: true })
  relatedProjectId!: string | null;

  @Column({ name: 'related_task_id', type: 'uuid', nullable: true })
  relatedTaskId!: string | null;

  @Column({ name: 'host_user_id', type: 'uuid', nullable: true })
  hostUserId!: string | null;

  @Column({ name: 'starts_at', type: 'timestamptz', nullable: true })
  startsAt!: Date | null;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt!: Date | null;

  @Column({ name: 'ended_at', type: 'timestamptz', nullable: true })
  endedAt!: Date | null;

  @Column({ name: 'recording_enabled', type: 'boolean', default: false })
  recordingEnabled!: boolean;

  @Column({ name: 'transcription_enabled', type: 'boolean', default: false })
  transcriptionEnabled!: boolean;

  @Column({ name: 'ai_summary_enabled', type: 'boolean', default: true })
  aiSummaryEnabled!: boolean;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
