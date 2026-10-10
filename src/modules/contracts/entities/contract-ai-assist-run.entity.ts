import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import type {
  ContractAiAssistResult,
  ContractAiAssistUsage,
} from '../ai-assist/contract-ai-assist.types';

@Entity('agency_contract_ai_assist_runs')
@Unique('UQ_contract_ai_assist_runs_key', [
  'tenantId',
  'workspaceId',
  'idempotencyKey',
])
@Index('IDX_contract_ai_assist_runs_daily', [
  'tenantId',
  'workspaceId',
  'createdAt',
])
export class ContractAiAssistRun {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;
  @Column({ name: 'workspace_id', type: 'uuid' }) workspaceId!: string;
  @Column({ name: 'idempotency_key', type: 'varchar', length: 120 })
  idempotencyKey!: string;
  @Column({ name: 'input_sha256', type: 'varchar', length: 64 })
  inputSha256!: string;
  @Column({ name: 'input_chars', type: 'integer' }) inputChars!: number;
  @Column({ name: 'target_type', type: 'varchar', length: 20 })
  targetType!: 'client';
  @Column({ type: 'varchar', length: 20 }) status!:
    | 'processing'
    | 'succeeded'
    | 'failed';
  @Column({ name: 'error_code', type: 'varchar', length: 80, nullable: true })
  errorCode!: string | null;
  @Column({ type: 'varchar', length: 160 }) model!: string;
  @Column({ name: 'prompt_version', type: 'varchar', length: 80 })
  promptVersion!: string;
  @Column({ type: 'jsonb', nullable: true })
  usage!: ContractAiAssistUsage | null;
  @Column({ type: 'jsonb', nullable: true })
  result!: ContractAiAssistResult | null;
  @Column({ name: 'latency_ms', type: 'integer', nullable: true }) latencyMs!:
    | number
    | null;
  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById!: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt!: Date | null;
}
