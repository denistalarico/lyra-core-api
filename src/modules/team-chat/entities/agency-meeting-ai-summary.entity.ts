import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { TeamChatAiSummaryStatus } from '../enums';
import type {
  MeetingAiExecution,
  MeetingAiEvidence,
  MeetingAiAction,
} from '../meeting-ai.types';

@Entity('agency_meeting_ai_summaries')
@Index(['tenantId', 'workspaceId'])
@Index(['meetingRoomId'])
@Index(
  'agency_meeting_ai_execution_unique',
  ['tenantId', 'workspaceId', 'meetingRoomId'],
  { unique: true, where: 'execution IS NOT NULL' },
)
export class AgencyMeetingAiSummary {
  @Column({ type: 'jsonb', nullable: true })
  execution!: MeetingAiExecution | null;

  @Column({ type: 'jsonb', nullable: true })
  agreements!: MeetingAiEvidence[] | null;

  @Column({ name: 'open_questions', type: 'jsonb', nullable: true })
  openQuestions!: string[] | null;

  @Column({ name: 'lease_token', type: 'uuid', nullable: true })
  leaseToken!: string | null;

  @Column({ name: 'lease_expires_at', type: 'timestamptz', nullable: true })
  leaseExpiresAt!: Date | null;

  @Column({ name: 'next_attempt_at', type: 'timestamptz', nullable: true })
  nextAttemptAt!: Date | null;

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
  topics!: string[] | null;

  @Column({ type: 'jsonb', nullable: true })
  decisions!: MeetingAiEvidence[] | null;

  @Column({ name: 'next_steps', type: 'jsonb', nullable: true })
  nextSteps!: string[] | null;

  @Column({ name: 'action_items', type: 'jsonb', nullable: true })
  actionItems!: MeetingAiAction[] | null;

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
