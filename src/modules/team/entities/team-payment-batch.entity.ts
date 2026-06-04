import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { TeamPaymentBatchStatus } from '../enums';
import { TeamPayment } from './team-payment.entity';

@Entity('team_payment_batches')
export class TeamPaymentBatch {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'competence_start', type: 'date' })
  competenceStart!: string;

  @Column({ name: 'competence_end', type: 'date' })
  competenceEnd!: string;

  @Column({
    type: 'enum',
    enum: TeamPaymentBatchStatus,
    default: TeamPaymentBatchStatus.Draft,
  })
  status!: TeamPaymentBatchStatus;

  @Column({ name: 'generated_at', type: 'timestamptz', nullable: true })
  generatedAt!: Date | null;

  @Column({ name: 'generated_by_id', type: 'uuid', nullable: true })
  generatedById!: string | null;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  metadata!: Record<string, unknown>;

  @OneToMany(() => TeamPayment, (payment) => payment.batch)
  payments!: TeamPayment[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
