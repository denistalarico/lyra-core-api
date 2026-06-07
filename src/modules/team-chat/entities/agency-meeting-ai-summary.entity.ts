import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { TeamChatAiSummaryStatus } from '../enums';

@Entity('agency_meeting_ai_summaries')
@Index(['tenantId', 'workspaceId'])
@Index(['meetingRoomId'])
export class AgencyMeetingAiSummary {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'meeting_room_id', type: 'uuid' })
  meetingRoomId!: string;

  @Column({
    type: 'enum',
    enum: TeamChatAiSummaryStatus,
    default: TeamChatAiSummaryStatus.PENDING,
  })
  status!: TeamChatAiSummaryStatus;

  @Column({ type: 'text', nullable: true })
  summary!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  topics!: unknown[] | null;

  @Column({ type: 'jsonb', nullable: true })
  decisions!: unknown[] | null;

  @Column({ name: 'next_steps', type: 'jsonb', nullable: true })
  nextSteps!: unknown[] | null;

  @Column({ name: 'action_items', type: 'jsonb', nullable: true })
  actionItems!: unknown[] | null;

  @Column({ name: 'transcript_ref', type: 'text', nullable: true })
  transcriptRef!: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  model!: string | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage!: string | null;

  @Column({ name: 'requested_by_id', type: 'uuid', nullable: true })
  requestedById!: string | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
