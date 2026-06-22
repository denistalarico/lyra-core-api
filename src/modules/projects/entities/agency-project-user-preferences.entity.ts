import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type ProjectBoardPreference = {
  foldedStageIds: string[];
  pinnedCardsByStage: Record<string, string[]>;
  cardOrderByStage: Record<string, string[]>;
};

export type ProjectUserPreferencesPayload = {
  overviewColumnOrder: string[];
  projectBoard: ProjectBoardPreference;
  workspaceTaskBoard: ProjectBoardPreference;
  personalTaskBoard: ProjectBoardPreference;
};

const emptyBoardPreference = {
  foldedStageIds: [],
  pinnedCardsByStage: {},
  cardOrderByStage: {},
};

@Entity('agency_project_user_preferences')
export class AgencyProjectUserPreferences {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'overview_column_order', type: 'jsonb', default: () => "'[]'::jsonb" })
  overviewColumnOrder!: string[];

  @Column({
    name: 'project_board',
    type: 'jsonb',
    default: () => `'${JSON.stringify(emptyBoardPreference)}'::jsonb`,
  })
  projectBoard!: ProjectBoardPreference;

  @Column({
    name: 'workspace_task_board',
    type: 'jsonb',
    default: () => `'${JSON.stringify(emptyBoardPreference)}'::jsonb`,
  })
  workspaceTaskBoard!: ProjectBoardPreference;

  @Column({
    name: 'personal_task_board',
    type: 'jsonb',
    default: () => `'${JSON.stringify(emptyBoardPreference)}'::jsonb`,
  })
  personalTaskBoard!: ProjectBoardPreference;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
