import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import {
  TeamChatMeetingParticipantRole,
  TeamChatMeetingParticipantStatus,
} from '../enums';

@Entity('agency_meeting_participants')
@Index(['tenantId', 'workspaceId'])
@Index(['meetingRoomId'])
@Index(['providerIdentity'])
export class AgencyMeetingParticipant {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'meeting_room_id', type: 'uuid' })
  meetingRoomId!: string;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId!: string | null;

  @Column({ name: 'team_member_id', type: 'uuid', nullable: true })
  teamMemberId!: string | null;

  @Column({ name: 'guest_name', type: 'varchar', length: 160, nullable: true })
  guestName!: string | null;

  @Column({ name: 'guest_email', type: 'varchar', length: 180, nullable: true })
  guestEmail!: string | null;

  @Column({
    type: 'enum',
    enum: TeamChatMeetingParticipantRole,
    default: TeamChatMeetingParticipantRole.MEMBER,
  })
  role!: TeamChatMeetingParticipantRole;

  @Column({
    type: 'enum',
    enum: TeamChatMeetingParticipantStatus,
    default: TeamChatMeetingParticipantStatus.INVITED,
  })
  status!: TeamChatMeetingParticipantStatus;

  @Column({ name: 'provider_identity', type: 'varchar', length: 220, nullable: true })
  providerIdentity!: string | null;

  @Column({ name: 'joined_at', type: 'timestamptz', nullable: true })
  joinedAt!: Date | null;

  @Column({ name: 'left_at', type: 'timestamptz', nullable: true })
  leftAt!: Date | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
