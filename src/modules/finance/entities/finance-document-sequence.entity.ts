import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { FinanceDocumentType } from '../enums';

@Entity('finance_document_sequences')
export class FinanceDocumentSequence {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({
    name: 'document_type',
    type: 'enum',
    enum: FinanceDocumentType,
  })
  documentType!: FinanceDocumentType;

  @Column({ name: 'period_year', type: 'integer' })
  periodYear!: number;

  @Column({ name: 'prefix', type: 'varchar', length: 20 })
  prefix!: string;

  @Column({ name: 'next_number', type: 'integer', default: 1 })
  nextNumber!: number;

  @Column({ name: 'padding', type: 'integer', default: 6 })
  padding!: number;

  @Column({ name: 'last_generated_number', type: 'varchar', length: 80, nullable: true })
  lastGeneratedNumber!: string | null;

  @Column({ name: 'metadata', type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
