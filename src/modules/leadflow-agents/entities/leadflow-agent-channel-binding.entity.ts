import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { LeadFlowAgentChannelStatus } from '../enums/leadflow-agent-channel-status.enum';
import type { LeadFlowJsonObject } from '../types/leadflow-agent.types';

/**
 * Structured binding between an agent and a LeadFlow channel/integration
 * connection (whatsapp / webchat / email). Sourced from the settings'
 * enabled integrations. No message is routed in this sprint.
 */
@Index('IDX_lf_agent_channel_bindings_agent_id', ['agentId'])
@Index('IDX_lf_agent_channel_bindings_tenant_workspace', [
  'tenantId',
  'workspaceId',
])
@Index(
  'IDX_lf_agent_channel_bindings_agent_channel',
  ['agentId', 'channelKey'],
  { unique: true },
)
@Entity('leadflow_agent_channel_bindings')
export class LeadFlowAgentChannelBindingEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'agent_id', type: 'uuid' })
  agentId!: string;

  @Column({ name: 'channel_key', type: 'varchar', length: 60 })
  channelKey!: string;

  @Column({ type: 'varchar', length: 60, nullable: true })
  provider!: string | null;

  @Column({ name: 'external_ref', type: 'varchar', length: 200, nullable: true })
  externalRef!: string | null;

  @Column({
    type: 'varchar',
    length: 30,
    default: LeadFlowAgentChannelStatus.Unbound,
  })
  status!: LeadFlowAgentChannelStatus;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  config!: LeadFlowJsonObject;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
