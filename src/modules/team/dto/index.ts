import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import {
  TeamMemberStatus,
  TeamRecordStatus,
  TeamSkillLevel,
  TeamWorkerType,
  TeamWorkMode,
  TeamPresenceStatus,
  TeamAttendanceType,
} from '../enums';

export class CreateTeamDepartmentDto {
  @IsString()
  @MaxLength(160)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(24)
  color?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  icon?: string;

  @IsOptional()
  @IsUUID()
  managerMemberId?: string;

  @IsOptional()
  @IsUUID()
  parentDepartmentId?: string;
}

export class UpdateTeamDepartmentDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(24)
  color?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  icon?: string | null;

  @IsOptional()
  @IsUUID()
  managerMemberId?: string | null;

  @IsOptional()
  @IsUUID()
  parentDepartmentId?: string | null;

  @IsOptional()
  @IsEnum(TeamRecordStatus)
  status?: TeamRecordStatus;
}

export class CreateTeamSkillDto {
  @IsString()
  @MaxLength(160)
  name!: string;

  @IsString()
  @MaxLength(100)
  category!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(24)
  color?: string;
}

export class UpdateTeamSkillDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  category?: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(24)
  color?: string | null;

  @IsOptional()
  @IsEnum(TeamRecordStatus)
  status?: TeamRecordStatus;
}

export class CreateTeamMemberDto {
  @IsString()
  @MaxLength(180)
  displayName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  legalName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  phone?: string;

  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsUUID()
  contactId?: string;

  @IsOptional()
  @IsUUID()
  contractId?: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsUUID()
  managerMemberId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  jobTitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  roleName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  seniority?: string;

  @IsOptional()
  @IsEnum(TeamWorkerType)
  workerType?: TeamWorkerType;

  @IsOptional()
  @IsEnum(TeamWorkMode)
  workMode?: TeamWorkMode;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  workLocation?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2)
  country?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  timezone?: string;

  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;

  @IsOptional()
  @IsBoolean()
  attendanceEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  overtimeApprovalRequired?: boolean;

  @IsOptional()
  @IsString()
  hourlyCost?: string;

  @IsOptional()
  @IsString()
  monthlyCost?: string;

  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateTeamMemberDto {
  @IsOptional()
  @IsString()
  @MaxLength(180)
  displayName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  legalName?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  email?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  phone?: string | null;

  @IsOptional()
  @IsUUID()
  userId?: string | null;

  @IsOptional()
  @IsUUID()
  contactId?: string | null;

  @IsOptional()
  @IsUUID()
  contractId?: string | null;

  @IsOptional()
  @IsUUID()
  departmentId?: string | null;

  @IsOptional()
  @IsUUID()
  managerMemberId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  jobTitle?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  roleName?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  seniority?: string | null;

  @IsOptional()
  @IsEnum(TeamWorkerType)
  workerType?: TeamWorkerType;

  @IsOptional()
  @IsEnum(TeamWorkMode)
  workMode?: TeamWorkMode;

  @IsOptional()
  @IsEnum(TeamMemberStatus)
  status?: TeamMemberStatus;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  workLocation?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2)
  country?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  timezone?: string | null;

  @IsOptional()
  @IsString()
  startDate?: string | null;

  @IsOptional()
  @IsString()
  endDate?: string | null;

  @IsOptional()
  @IsBoolean()
  attendanceEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  overtimeApprovalRequired?: boolean;

  @IsOptional()
  @IsString()
  hourlyCost?: string | null;

  @IsOptional()
  @IsString()
  monthlyCost?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @IsOptional()
  @IsString()
  avatarUrl?: string | null;

  @IsOptional()
  @IsString()
  resumeFileKey?: string | null;

  @IsOptional()
  @IsString()
  barcodeValue?: string | null;

  @IsOptional()
  @IsString()
  notes?: string | null;
}

export class ListTeamMembersQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsEnum(TeamMemberStatus)
  status?: TeamMemberStatus;

  @IsOptional()
  @IsEnum(TeamWorkerType)
  workerType?: TeamWorkerType;
}

export class UpsertTeamMemberSkillDto {
  @IsUUID()
  skillId!: string;

  @IsOptional()
  @IsEnum(TeamSkillLevel)
  level?: TeamSkillLevel;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateTeamPresenceDto {
  @IsEnum(TeamPresenceStatus)
  status!: TeamPresenceStatus;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  statusMessage?: string | null;
}

export class CreateTeamAttendanceEntryDto {
  @IsEnum(TeamAttendanceType)
  type!: TeamAttendanceType;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  timezone?: string;

  @IsOptional()
  @IsString()
  note?: string;
}

export class TeamKioskPunchDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  pinCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  barcodeValue?: string;

  @IsEnum(TeamAttendanceType)
  type!: TeamAttendanceType;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  timezone?: string;

  @IsOptional()
  @IsString()
  note?: string;
}

export class UpdateTeamMemberAccessCodeDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  pinCode?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  barcodeValue?: string | null;
}
