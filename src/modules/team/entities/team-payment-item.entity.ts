import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { TeamPaymentItemType } from '../enums';
import { TeamPayment } from './team-payment.entity';

@Entity('team_payment_items')
@Index(['tenantId', 'workspaceId', 'paymentId'])
export class TeamPaymentItem {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'payment_id', type: 'uuid' })
  paymentId!: string;

  @Column({
    type: 'enum',
    enum: TeamPaymentItemType,
    default: TeamPaymentItemType.Adjustment,
  })
  type!: TeamPaymentItemType;

  @Column({ type: 'varchar', length: 180 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'numeric', precision: 14, scale: 2, default: 0 })
  amount!: string;

  @Column({ type: 'numeric', precision: 10, scale: 2, default: 1 })
  quantity!: string;

  @Column({ name: 'unit_value', type: 'numeric', precision: 14, scale: 2, default: 0 })
  unitValue!: string;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  metadata!: Record<string, unknown>;

  @ManyToOne(() => TeamPayment, (payment) => payment.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'payment_id' })
  payment!: TeamPayment;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
