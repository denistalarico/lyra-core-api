import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { FinanceCostCenterType } from '../enums';

@Entity('finance_cost_centers')
export class FinanceCostCenter {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'name', type: 'varchar', length: 160 })
  name!: string;

  @Column({
    name: 'type',
    type: 'enum',
    enum: FinanceCostCenterType,
    default: FinanceCostCenterType.Other,
  })
  type!: FinanceCostCenterType;

  @Column({ name: 'related_entity_type', type: 'varchar', length: 80, nullable: true })
  relatedEntityType!: string | null;

  @Column({ name: 'related_entity_id', type: 'uuid', nullable: true })
  relatedEntityId!: string | null;

  @Column({ name: 'active', type: 'boolean', default: true })
  active!: boolean;

  @Column({ name: 'metadata', type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
