import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { LeadFlowBriefingSourceKind } from '../enums/leadflow-briefing-source-kind.enum';
import { LeadFlowBriefingSourceVersionStatus } from '../enums/leadflow-briefing-source-version-status.enum';
import type { LeadFlowJsonObject } from '../../leadflow-settings/types/leadflow-settings.types';

/**
 * One immutable capture of a source's content ("duas versões" scenario: a
 * source gets re-uploaded/updated, each capture is a new row here). Upload
 * pointer/URL/text fields exist now but are only populated starting F4-002 —
 * this task models ingestion status without implementing ingestion.
 */
@Index('IDX_lf_briefing_source_versions_scope', [
  'tenantId',
  'workspaceId',
  'sourceId',
])
@Index('UQ_lf_briefing_source_versions_number', ['sourceId', 'versionNumber'], {
  unique: true,
})
@Index(
  'UQ_lf_briefing_source_versions_checksum',
  ['sourceId', 'checksum'],
  { unique: true, where: 'checksum IS NOT NULL' },
)
@Entity('leadflow_briefing_source_versions')
export class LeadFlowBriefingSourceVersionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'source_id', type: 'uuid' })
  sourceId!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'version_number', type: 'int' })
  versionNumber!: number;

  @Column({ type: 'varchar', length: 20 })
  kind!: LeadFlowBriefingSourceKind;

  @Column({ name: 'object_key', type: 'text', nullable: true })
  objectKey!: string | null;

  @Column({ name: 'source_url', type: 'text', nullable: true })
  sourceUrl!: string | null;

  @Column({ name: 'raw_text', type: 'text', nullable: true })
  rawText!: string | null;

  @Column({ name: 'mime_type', type: 'varchar', length: 120, nullable: true })
  mimeType!: string | null;

  @Column({ name: 'byte_size', type: 'bigint', nullable: true })
  byteSize!: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  checksum!: string | null;

  @Column({ name: 'safe_filename', type: 'varchar', length: 220, nullable: true })
  safeFilename!: string | null;

  @Column({
    type: 'varchar',
    length: 20,
    default: LeadFlowBriefingSourceVersionStatus.Pending,
  })
  status!: LeadFlowBriefingSourceVersionStatus;

  @Column({ name: 'error_code', type: 'varchar', length: 80, nullable: true })
  errorCode!: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: LeadFlowJsonObject;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
