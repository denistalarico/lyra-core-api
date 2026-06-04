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
import { TeamPaymentDocumentType } from '../enums';
import { TeamPayment } from './team-payment.entity';

@Entity('team_payment_documents')
@Index(['tenantId', 'workspaceId', 'paymentId'])
export class TeamPaymentDocument {
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
    enum: TeamPaymentDocumentType,
    default: TeamPaymentDocumentType.Statement,
  })
  type!: TeamPaymentDocumentType;

  @Column({ type: 'varchar', length: 180 })
  title!: string;

  @Column({ name: 'html_content', type: 'text', nullable: true })
  htmlContent!: string | null;

  @Column({ name: 'pdf_file_key', type: 'text', nullable: true })
  pdfFileKey!: string | null;

  @Column({ type: 'varchar', length: 40, default: 'draft' })
  status!: string;

  @Column({ name: 'generated_at', type: 'timestamptz', nullable: true })
  generatedAt!: Date | null;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  metadata!: Record<string, unknown>;

  @ManyToOne(() => TeamPayment, (payment) => payment.documents, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'payment_id' })
  payment!: TeamPayment;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
