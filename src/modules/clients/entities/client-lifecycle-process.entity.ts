import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ClientLifecycleProcessStatus, ClientLifecycleProcessType } from '../enums';

@Entity('client_lifecycle_processes')
@Index('idx_client_lifecycle_processes_client', ['tenantId', 'workspaceId', 'clientId'])
export class ClientLifecycleProcess {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'client_id', type: 'uuid' })
  clientId!: string;

  @Column({ name: 'process_type', type: 'varchar', length: 20 })
  processType!: ClientLifecycleProcessType;

  @Column({ type: 'varchar', length: 24, default: ClientLifecycleProcessStatus.InProgress })
  status!: ClientLifecycleProcessStatus;

  @Column({ name: 'template_config_option_id', type: 'uuid', nullable: true })
  templateConfigOptionId!: string | null;

  @Column({ name: 'lost_reason_id', type: 'uuid', nullable: true })
  lostReasonId!: string | null;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt!: Date | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById!: string | null;

  @Column({ name: 'updated_by_id', type: 'uuid', nullable: true })
  updatedById!: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
