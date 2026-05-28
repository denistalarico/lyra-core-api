import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { TeamRecordStatus } from '../enums';

@Entity('team_departments')
export class TeamDepartment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'name', type: 'varchar', length: 160 })
  name!: string;

  @Column({ name: 'slug', type: 'varchar', length: 160 })
  slug!: string;

  @Column({ name: 'description', type: 'text', nullable: true })
  description!: string | null;

  @Column({ name: 'color', type: 'varchar', length: 24, nullable: true })
  color!: string | null;

  @Column({ name: 'icon', type: 'varchar', length: 80, nullable: true })
  icon!: string | null;

  @Column({ name: 'manager_member_id', type: 'uuid', nullable: true })
  managerMemberId!: string | null;

  @Column({ name: 'parent_department_id', type: 'uuid', nullable: true })
  parentDepartmentId!: string | null;

  @Column({ name: 'status', type: 'varchar', length: 40, default: TeamRecordStatus.Active })
  status!: TeamRecordStatus;

  @Column({ name: 'is_system_default', type: 'boolean', default: false })
  isSystemDefault!: boolean;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById!: string | null;

  @Column({ name: 'position', type: 'integer', default: 0 })
  position!: number;

  @Column({ name: 'metadata', type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
