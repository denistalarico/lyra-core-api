import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { FinanceAccountStatus, FinanceAccountType } from '../enums';

@Entity('finance_accounts')
export class FinanceAccount {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'code', type: 'varchar', length: 40 })
  code!: string;

  @Column({ name: 'name', type: 'varchar', length: 160 })
  name!: string;

  @Column({
    name: 'type',
    type: 'enum',
    enum: FinanceAccountType,
  })
  type!: FinanceAccountType;

  @Column({
    name: 'status',
    type: 'enum',
    enum: FinanceAccountStatus,
    default: FinanceAccountStatus.Active,
  })
  status!: FinanceAccountStatus;

  @Column({ name: 'parent_id', type: 'uuid', nullable: true })
  parentId!: string | null;

  @Column({ name: 'is_system', type: 'boolean', default: false })
  isSystem!: boolean;

  @Column({ name: 'description', type: 'text', nullable: true })
  description!: string | null;

  @Column({ name: 'metadata', type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
