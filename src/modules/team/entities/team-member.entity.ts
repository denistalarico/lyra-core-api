import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { TeamMemberStatus, TeamWorkerType, TeamWorkMode } from '../enums';

@Entity('team_members')
export class TeamMember {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId!: string | null;

  @Column({ name: 'contact_id', type: 'uuid', nullable: true })
  contactId!: string | null;

  @Column({ name: 'contract_id', type: 'uuid', nullable: true })
  contractId!: string | null;

  @Column({ name: 'department_id', type: 'uuid', nullable: true })
  departmentId!: string | null;

  @Column({ name: 'manager_member_id', type: 'uuid', nullable: true })
  managerMemberId!: string | null;

  @Column({ name: 'display_name', type: 'varchar', length: 180 })
  displayName!: string;

  @Column({ name: 'legal_name', type: 'varchar', length: 180, nullable: true })
  legalName!: string | null;

  @Column({ name: 'email', type: 'varchar', length: 180, nullable: true })
  email!: string | null;

  @Column({ name: 'phone', type: 'varchar', length: 80, nullable: true })
  phone!: string | null;

  @Column({ name: 'avatar_url', type: 'text', nullable: true })
  avatarUrl!: string | null;

  @Column({ name: 'job_title', type: 'varchar', length: 160, nullable: true })
  jobTitle!: string | null;

  @Column({ name: 'role_name', type: 'varchar', length: 160, nullable: true })
  roleName!: string | null;

  @Column({ name: 'seniority', type: 'varchar', length: 80, nullable: true })
  seniority!: string | null;

  @Column({ name: 'worker_type', type: 'varchar', length: 60, default: TeamWorkerType.Contractor })
  workerType!: TeamWorkerType;

  @Column({ name: 'work_mode', type: 'varchar', length: 120, default: TeamWorkMode.Flexible })
  workMode!: string;

  @Column({ name: 'status', type: 'varchar', length: 40, default: TeamMemberStatus.Active })
  status!: TeamMemberStatus;

  @Column({ name: 'work_location', type: 'varchar', length: 180, nullable: true })
  workLocation!: string | null;

  @Column({ name: 'country', type: 'varchar', length: 2, nullable: true })
  country!: string | null;

  @Column({ name: 'timezone', type: 'varchar', length: 80, nullable: true })
  timezone!: string | null;

  @Column({ name: 'start_date', type: 'date', nullable: true })
  startDate!: string | null;

  @Column({ name: 'end_date', type: 'date', nullable: true })
  endDate!: string | null;

  @Column({ name: 'pin_code_hash', type: 'varchar', length: 180, nullable: true, select: false })
  pinCodeHash!: string | null;

  @Column({ name: 'barcode_value', type: 'varchar', length: 180, nullable: true })
  barcodeValue!: string | null;

  @Column({ name: 'attendance_enabled', type: 'boolean', default: false })
  attendanceEnabled!: boolean;

  @Column({ name: 'overtime_approval_required', type: 'boolean', default: true })
  overtimeApprovalRequired!: boolean;

  @Column({ name: 'hourly_cost', type: 'numeric', precision: 12, scale: 2, nullable: true })
  hourlyCost!: string | null;

  @Column({ name: 'monthly_cost', type: 'numeric', precision: 12, scale: 2, nullable: true })
  monthlyCost!: string | null;

  @Column({ name: 'currency', type: 'varchar', length: 3, default: 'USD' })
  currency!: string;

  @Column({ name: 'resume_file_key', type: 'text', nullable: true })
  resumeFileKey!: string | null;

  @Column({ name: 'notes', type: 'text', nullable: true })
  notes!: string | null;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById!: string | null;

  @Column({ name: 'updated_by_id', type: 'uuid', nullable: true })
  updatedById!: string | null;

  @Column({ name: 'archived_at', type: 'timestamptz', nullable: true })
  archivedAt!: Date | null;

  @Column({ name: 'metadata', type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
