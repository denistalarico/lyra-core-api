import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { LeadFlowAgentVersionStatus } from '../enums/leadflow-agent-version-status.enum';
import type {
  LeadFlowAgentRuntimeContract,
  LeadFlowJsonObject,
} from '../types/leadflow-agent.types';

/**
 * Immutable snapshot of an agent produced by the `publish` action. The
 * `snapshot` holds the full runtime contract at publish time so a future
 * runtime can pin a specific published version.
 */
@Index('IDX_lf_agent_versions_agent_id', ['agentId'])
@Index('IDX_lf_agent_versions_agent_version', ['agentId', 'version'], {
  unique: true,
})
@Entity('leadflow_agent_versions')
export class LeadFlowAgentVersionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'agent_id', type: 'uuid' })
  agentId!: string;

  @Column({ type: 'integer' })
  version!: number;

  @Column({
    type: 'varchar',
    length: 30,
    default: LeadFlowAgentVersionStatus.Published,
  })
  status!: LeadFlowAgentVersionStatus;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  snapshot!: LeadFlowAgentRuntimeContract | LeadFlowJsonObject;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
