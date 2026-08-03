import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { LeadFlowBriefingSuggestionStatus } from '../enums/leadflow-briefing-suggestion-status.enum';

/**
 * A single field-level suggestion produced by one extraction job ("sugestão").
 * `conflictsWithSuggestionId` points at the currently-applied suggestion for
 * the same field when one exists — surfaced to a human, never auto-resolved.
 */
@Index('IDX_lf_briefing_suggestions_field', [
  'tenantId',
  'workspaceId',
  'settingsId',
  'fieldPath',
  'status',
])
@Index('IDX_lf_briefing_suggestions_source_version', ['sourceVersionId'])
@Index(
  'UQ_lf_briefing_suggestions_job_field',
  ['extractionJobId', 'fieldPath'],
  { unique: true },
)
@Entity('leadflow_briefing_suggestions')
export class LeadFlowBriefingSuggestionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'settings_id', type: 'uuid' })
  settingsId!: string;

  @Column({ name: 'extraction_job_id', type: 'uuid' })
  extractionJobId!: string;

  @Column({ name: 'source_version_id', type: 'uuid' })
  sourceVersionId!: string;

  @Column({ name: 'field_path', type: 'varchar', length: 200 })
  fieldPath!: string;

  @Column({ name: 'suggested_value', type: 'jsonb' })
  suggestedValue!: unknown;

  @Column({ type: 'numeric', precision: 4, scale: 3, nullable: true })
  confidence!: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  rationale!: string | null;

  @Column({
    type: 'varchar',
    length: 20,
    default: LeadFlowBriefingSuggestionStatus.Pending,
  })
  status!: LeadFlowBriefingSuggestionStatus;

  @Column({ name: 'superseded_by_suggestion_id', type: 'uuid', nullable: true })
  supersededBySuggestionId!: string | null;

  @Column({ name: 'conflicts_with_suggestion_id', type: 'uuid', nullable: true })
  conflictsWithSuggestionId!: string | null;

  @Column({ name: 'decided_by_id', type: 'uuid', nullable: true })
  decidedById!: string | null;

  @Column({ name: 'decided_at', type: 'timestamptz', nullable: true })
  decidedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
