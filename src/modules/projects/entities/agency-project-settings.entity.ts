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

export type ProjectTaskExecutionMode = 'manual' | 'timer' | 'hybrid';

@Entity('agency_project_settings')
export class AgencyProjectSettings {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'project_markers', type: 'jsonb', default: () => "'[]'::jsonb" })
  projectMarkers!: ProjectMarkerSetting[];

  @Column({ name: 'task_markers', type: 'jsonb', default: () => "'[]'::jsonb" })
  taskMarkers!: ProjectMarkerSetting[];

  @Column({ name: 'task_types', type: 'jsonb', default: () => "'[]'::jsonb" })
  taskTypes!: ProjectTaskTypeSetting[];

  @Column({ name: 'task_execution_mode', type: 'varchar', length: 24, default: 'hybrid' })
  taskExecutionMode!: ProjectTaskExecutionMode;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
