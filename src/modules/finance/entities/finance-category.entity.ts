import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { FinanceCategoryType, FinanceCostBehavior } from '../enums';

@Entity('finance_categories')
export class FinanceCategory {
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
    enum: FinanceCategoryType,
  })
  type!: FinanceCategoryType;

  @Column({
    name: 'cost_behavior',
    type: 'enum',
    enum: FinanceCostBehavior,
    nullable: true,
  })
  costBehavior!: FinanceCostBehavior | null;

  @Column({ name: 'account_id', type: 'uuid', nullable: true })
  accountId!: string | null;

  @Column({ name: 'color', type: 'varchar', length: 24, nullable: true })
  color!: string | null;

  @Column({ name: 'active', type: 'boolean', default: true })
  active!: boolean;

  @Column({ name: 'metadata', type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
