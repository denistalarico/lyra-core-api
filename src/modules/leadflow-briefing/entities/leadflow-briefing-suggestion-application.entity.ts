import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Records a human applying one suggestion to the draft ("aplicação"). Insert
 * only — never updated — so "no silent overwrite" is trivial to enforce: a
 * suggestion can be applied at most once (UNIQUE suggestion_id) and this row
 * never changes after creation.
 */
@Index('IDX_lf_briefing_applications_field', [
  'tenantId',
  'workspaceId',
  'settingsId',
  'fieldPath',
  'createdAt',
])
@Index('UQ_lf_briefing_applications_suggestion', ['suggestionId'], {
  unique: true,
})
@Entity('leadflow_briefing_suggestion_applications')
export class LeadFlowBriefingSuggestionApplicationEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'settings_id', type: 'uuid' })
  settingsId!: string;

  @Column({ name: 'suggestion_id', type: 'uuid' })
  suggestionId!: string;

  @Column({ name: 'field_path', type: 'varchar', length: 200 })
  fieldPath!: string;

  @Column({ name: 'previous_value', type: 'jsonb', nullable: true })
  previousValue!: unknown;

  @Column({ name: 'applied_value', type: 'jsonb' })
  appliedValue!: unknown;

  @Column({ name: 'resulting_snapshot_id', type: 'uuid' })
  resultingSnapshotId!: string;

  @Column({ name: 'applied_by_id', type: 'uuid' })
  appliedById!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
