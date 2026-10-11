import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  Unique,
} from 'typeorm';
import { ContractTargetType } from '../enums';
@Entity('agency_contract_defaults')
@Unique(['tenantId', 'workspaceId', 'targetType'])
export class ContractDefaults {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;
  @Column({ name: 'workspace_id', type: 'uuid' }) workspaceId!: string;
  @Column({ name: 'target_type', type: 'varchar', length: 60 })
  targetType!: ContractTargetType;
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" }) values!: Record<
    string,
    string
  >;
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" }) presets!: Record<
    string,
    string
  >;
  @Column({ name: 'expiring_window_days', type: 'integer', default: 30 })
  expiringWindowDays!: number;
  @Column({ type: 'integer', default: 1 }) version!: number;
  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById!: string | null;
  @Column({ name: 'updated_by_id', type: 'uuid', nullable: true })
  updatedById!: string | null;
  @CreateDateColumn({ name: 'created_at' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt!: Date;
}
