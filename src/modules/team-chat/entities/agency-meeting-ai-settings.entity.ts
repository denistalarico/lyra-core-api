import {
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { MeetingAiConfig } from '../meeting-ai.types';
import { DEFAULT_MEETING_AI_CONFIG } from '../meeting-ai.types';

@Entity('agency_meeting_ai_settings')
@Index(['tenantId', 'workspaceId'], { unique: true })
export class AgencyMeetingAiSettings {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;
  @Column({ name: 'workspace_id', type: 'uuid' }) workspaceId!: string;
  @Column({
    type: 'jsonb',
    default: () => `'${JSON.stringify(DEFAULT_MEETING_AI_CONFIG)}'::jsonb`,
  })
  config!: MeetingAiConfig;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
