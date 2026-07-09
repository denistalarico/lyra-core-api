import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { LeadFlowAutomationVersionStatus } from '../enums/leadflow-automation-version-status.enum';
import type {
  LeadFlowAutomationRuntimeContract,
  LeadFlowJsonObject,
} from '../types/leadflow-automation.types';

/**
 * Immutable snapshot of an automation produced by the `publish` action. The
 * `snapshot` holds the full runtime contract at publish time (secrets already
 * masked) so a future runtime can pin a specific published version.
 */
@Index('IDX_lf_automation_versions_automation_id', ['automationId'])
@Index(
  'IDX_lf_automation_versions_automation_version',
  ['automationId', 'version'],
  { unique: true },
)
@Entity('leadflow_automation_versions')
export class LeadFlowAutomationVersionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'automation_id', type: 'uuid' })
  automationId!: string;

  @Column({ type: 'integer' })
  version!: number;

  @Column({
    type: 'varchar',
    length: 30,
    default: LeadFlowAutomationVersionStatus.Published,
  })
  status!: LeadFlowAutomationVersionStatus;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  snapshot!: LeadFlowAutomationRuntimeContract | LeadFlowJsonObject;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
