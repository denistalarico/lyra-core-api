import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { LeadFlowSettingsContextType } from '../../leadflow-settings/enums/leadflow-settings-context-type.enum';
import { LeadFlowBriefingSourceKind } from '../enums/leadflow-briefing-source-kind.enum';

/** A logical briefing source ("fonte"): the re-upload/version axis lives in LeadFlowBriefingSourceVersionEntity. */
@Index('IDX_lf_briefing_sources_scope', ['tenantId', 'workspaceId', 'settingsId'])
@Index('IDX_lf_briefing_sources_status', ['tenantId', 'workspaceId', 'status'])
@Entity('leadflow_briefing_sources')
export class LeadFlowBriefingSourceEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({
    name: 'context_type',
    type: 'varchar',
    length: 30,
    default: LeadFlowSettingsContextType.Client,
  })
  contextType!: LeadFlowSettingsContextType;

  @Column({ name: 'agency_client_id', type: 'uuid', nullable: true })
  agencyClientId!: string | null;

  @Column({ name: 'settings_id', type: 'uuid' })
  settingsId!: string;

  @Column({
    type: 'varchar',
    length: 20,
    default: LeadFlowBriefingSourceKind.Upload,
  })
  kind!: LeadFlowBriefingSourceKind;

  @Column({ type: 'varchar', length: 160 })
  label!: string;

  @Column({ type: 'varchar', length: 20, default: 'active' })
  status!: 'active' | 'archived';

  @Column({ name: 'latest_version_number', type: 'int', default: 0 })
  latestVersionNumber!: number;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ name: 'archived_at', type: 'timestamptz', nullable: true })
  archivedAt!: Date | null;
}
