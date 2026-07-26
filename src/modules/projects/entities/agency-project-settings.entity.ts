import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type ProjectMarkerSetting = {
  id: string;
  name: string;
  color: string;
};

export type ProjectTaskTypeSetting = {
  id: string;
  name: string;
};

export type ProjectStageTemplateStage = {
  name: string;
  color: string | null;
};

export type ProjectStageTemplate = {
  id: string;
  name: string;
  stages: ProjectStageTemplateStage[];
};

export type ProjectTaskExecutionMode = 'manual' | 'timer' | 'hybrid';

export type ProjectCardDisplaySettings = {
  client: boolean;
  project: boolean;
  cover: boolean;
  markers: boolean;
  priority: boolean;
  progress: boolean;
  taskCount: boolean;
  activity: boolean;
  subtasks: boolean;
  responsible: boolean;
  dueDate: boolean;
  status: boolean;
};

@Entity('agency_project_settings')
export class AgencyProjectSettings {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({
    name: 'project_markers',
    type: 'jsonb',
    default: () => "'[]'::jsonb",
  })
  projectMarkers!: ProjectMarkerSetting[];

  @Column({ name: 'task_markers', type: 'jsonb', default: () => "'[]'::jsonb" })
  taskMarkers!: ProjectMarkerSetting[];

  @Column({ name: 'task_types', type: 'jsonb', default: () => "'[]'::jsonb" })
  taskTypes!: ProjectTaskTypeSetting[];

  @Column({
    name: 'task_execution_mode',
    type: 'varchar',
    length: 24,
    default: 'hybrid',
  })
  taskExecutionMode!: ProjectTaskExecutionMode;

  @Column({
    name: 'stage_templates',
    type: 'jsonb',
    default: () => "'[]'::jsonb",
  })
  stageTemplates!: ProjectStageTemplate[];

  @Column({
    name: 'project_card_display_defaults',
    type: 'jsonb',
    default: () => "'{}'::jsonb",
  })
  projectCardDisplayDefaults!: Partial<ProjectCardDisplaySettings>;

  @Column({
    name: 'task_card_display_defaults',
    type: 'jsonb',
    default: () => "'{}'::jsonb",
  })
  taskCardDisplayDefaults!: Partial<ProjectCardDisplaySettings>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
