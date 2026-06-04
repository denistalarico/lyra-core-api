import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import {
  TeamPaymentCalculationMode,
  TeamPaymentStatus,
} from '../enums';
import { TeamMember } from './team-member.entity';
import { TeamPaymentBatch } from './team-payment-batch.entity';
import { TeamPaymentItem } from './team-payment-item.entity';
import { TeamPaymentDocument } from './team-payment-document.entity';

@Entity('team_payments')
@Index(['tenantId', 'workspaceId', 'memberId'])
@Index(['tenantId', 'workspaceId', 'status'])
@Index(['tenantId', 'workspaceId', 'competenceStart', 'competenceEnd'])
export class TeamPayment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'batch_id', type: 'uuid', nullable: true })
  batchId!: string | null;

  @Column({ name: 'member_id', type: 'uuid' })
  memberId!: string;

  @Column({ name: 'contract_id', type: 'uuid', nullable: true })
  contractId!: string | null;

  @Column({ name: 'finance_bill_id', type: 'uuid', nullable: true })
  financeBillId!: string | null;

  @Column({ name: 'finance_payment_id', type: 'uuid', nullable: true })
  financePaymentId!: string | null;

  @Column({ name: 'competence_start', type: 'date' })
  competenceStart!: string;

  @Column({ name: 'competence_end', type: 'date' })
  competenceEnd!: string;

  @Column({ name: 'due_date', type: 'date', nullable: true })
  dueDate!: string | null;

  @Column({ name: 'paid_at', type: 'timestamptz', nullable: true })
  paidAt!: Date | null;

  @Column({
    type: 'enum',
    enum: TeamPaymentStatus,
    default: TeamPaymentStatus.Draft,
  })
  status!: TeamPaymentStatus;

  @Column({
    name: 'calculation_mode',
    type: 'enum',
    enum: TeamPaymentCalculationMode,
    default: TeamPaymentCalculationMode.Manual,
  })
  calculationMode!: TeamPaymentCalculationMode;

  @Column({ name: 'base_amount', type: 'numeric', precision: 14, scale: 2, default: 0 })
  baseAmount!: string;

  @Column({ name: 'worked_hours', type: 'numeric', precision: 10, scale: 2, default: 0 })
  workedHours!: string;

  @Column({ name: 'overtime_hours', type: 'numeric', precision: 10, scale: 2, default: 0 })
  overtimeHours!: string;

  @Column({ name: 'worked_days', type: 'numeric', precision: 10, scale: 2, default: 0 })
  workedDays!: string;

  @Column({ name: 'gross_amount', type: 'numeric', precision: 14, scale: 2, default: 0 })
  grossAmount!: string;

  @Column({ name: 'benefits_total', type: 'numeric', precision: 14, scale: 2, default: 0 })
  benefitsTotal!: string;

  @Column({ name: 'discounts_total', type: 'numeric', precision: 14, scale: 2, default: 0 })
  discountsTotal!: string;

  @Column({ name: 'net_amount', type: 'numeric', precision: 14, scale: 2, default: 0 })
  netAmount!: string;

  @Column({ type: 'varchar', length: 3, default: 'BRL' })
  currency!: string;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  metadata!: Record<string, unknown>;

  @ManyToOne(() => TeamPaymentBatch, (batch) => batch.payments, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'batch_id' })
  batch!: TeamPaymentBatch | null;

  @ManyToOne(() => TeamMember, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'member_id' })
  member!: TeamMember;

  @OneToMany(() => TeamPaymentItem, (item) => item.payment)
  items!: TeamPaymentItem[];

  @OneToMany(() => TeamPaymentDocument, (document) => document.payment)
  documents!: TeamPaymentDocument[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
