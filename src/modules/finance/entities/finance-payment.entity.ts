import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import {
  FinancePaymentDirection,
  FinancePaymentMethod,
  FinancePaymentStatus,
} from '../enums';

@Entity('finance_payments')
export class FinancePayment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({
    name: 'direction',
    type: 'enum',
    enum: FinancePaymentDirection,
  })
  direction!: FinancePaymentDirection;

  @Column({
    name: 'status',
    type: 'enum',
    enum: FinancePaymentStatus,
    default: FinancePaymentStatus.Completed,
  })
  status!: FinancePaymentStatus;

  @Column({
    name: 'method',
    type: 'enum',
    enum: FinancePaymentMethod,
    default: FinancePaymentMethod.Manual,
  })
  method!: FinancePaymentMethod;

  @Column({ name: 'contact_id', type: 'uuid', nullable: true })
  contactId!: string | null;

  @Column({ name: 'bank_account_id', type: 'uuid', nullable: true })
  bankAccountId!: string | null;

  @Column({ name: 'payment_date', type: 'date' })
  paymentDate!: string;

  @Column({ name: 'amount', type: 'numeric', precision: 14, scale: 2 })
  amount!: string;

  @Column({ name: 'allocated_amount', type: 'numeric', precision: 14, scale: 2, default: 0 })
  allocatedAmount!: string;

  @Column({ name: 'currency', type: 'varchar', length: 3, default: 'BRL' })
  currency!: string;

  @Column({ name: 'external_provider', type: 'varchar', length: 80, nullable: true })
  externalProvider!: string | null;

  @Column({ name: 'external_reference', type: 'varchar', length: 180, nullable: true })
  externalReference!: string | null;

  @Column({ name: 'description', type: 'varchar', length: 255, nullable: true })
  description!: string | null;

  @Column({ name: 'metadata', type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
