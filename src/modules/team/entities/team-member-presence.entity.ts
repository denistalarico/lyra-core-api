import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { TeamPresenceSource, TeamPresenceStatus } from '../enums';

@Entity('team_member_presence')
export class TeamMemberPresence {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'member_id', type: 'uuid' })
  memberId!: string;

  @Column({
    name: 'status',
    type: 'varchar',
    length: 40,
    default: TeamPresenceStatus.Offline,
  })
  status!: TeamPresenceStatus;

  @Column({ name: 'status_message', type: 'varchar', length: 180, nullable: true })
  statusMessage!: string | null;

  @Column({
    name: 'source',
    type: 'varchar',
    length: 40,
    default: TeamPresenceSource.System,
  })
  source!: TeamPresenceSource;

  @Column({ name: 'last_seen_at', type: 'timestamptz', nullable: true })
  lastSeenAt!: Date | null;

  @Column({ name: 'updated_by_id', type: 'uuid', nullable: true })
  updatedById!: string | null;

  @Column({ name: 'metadata', type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
