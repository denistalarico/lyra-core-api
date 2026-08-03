import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { LeadFlowBriefingSnapshotKind } from '../enums/leadflow-briefing-snapshot-kind.enum';
import type { LeadFlowJsonObject } from '../../leadflow-settings/types/leadflow-settings.types';

/**
 * Append-only ledger of every companyContextDraft mutation and every publish
 * event ("publicação" + draft history, merged — see plan doc reasoning: one
 * ledger typed by snapshot_kind avoids keeping two ledgers in sync). Ordered
 * by created_at, the row before the latest one is "the previous draft".
 */
@Index('IDX_lf_briefing_snapshots_settings', ['settingsId', 'createdAt'])
@Index(
  'UQ_lf_briefing_snapshots_published_version',
  ['settingsId', 'publishedVersion'],
  { unique: true, where: "snapshot_kind = 'published'" },
)
@Entity('leadflow_briefing_context_snapshots')
export class LeadFlowBriefingContextSnapshotEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'settings_id', type: 'uuid' })
  settingsId!: string;

  @Column({ name: 'snapshot_kind', type: 'varchar', length: 20 })
  snapshotKind!: LeadFlowBriefingSnapshotKind;

  @Column({ name: 'draft_value', type: 'jsonb' })
  draftValue!: LeadFlowJsonObject;

  @Column({ name: 'draft_hash', type: 'varchar', length: 64 })
  draftHash!: string;

  @Column({ name: 'schema_version', type: 'int', default: 1 })
  schemaVersion!: number;

  @Column({ name: 'published_version', type: 'int', nullable: true })
  publishedVersion!: number | null;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
