import {
Column,
CreateDateColumn,
Entity,
PrimaryGeneratedColumn,
} from 'typeorm';
import { ContractEventType } from '../enums';

@Entity('agency_contract_events')
export class ContractEvent {
@PrimaryGeneratedColumn('uuid')
id!: string;

@Column({ name: 'tenant_id', type: 'uuid' })
tenantId!: string;

@Column({ name: 'workspace_id', type: 'uuid' })
workspaceId!: string;

@Column({ name: 'contract_id', type: 'uuid' })
contractId!: string;

@Column({ type: 'varchar', length: 80 })
type!: ContractEventType;

@Column({ name: 'actor_user_id', type: 'uuid', nullable: true })
actorUserId!: string | null;

@Column({ type: 'text', nullable: true })
message!: string | null;

@Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
metadata!: Record<string, unknown>;

@CreateDateColumn({ name: 'created_at' })
createdAt!: Date;
}
