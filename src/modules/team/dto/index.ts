import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
  Min,
  IsNumber,
  IsIn,
  IsDateString,
  IsArray,
  MaxLength,
} from 'class-validator';
import {
  TeamMemberStatus,
  TeamRecordStatus,
  TeamSkillLevel,
  TeamWorkerType,
  TeamConfigOptionType,
  TeamPresenceStatus,
  TeamAttendanceType,
  TeamPaymentBatchStatus,
  TeamPaymentStatus,
  TeamPaymentCalculationMode,
  TeamPaymentItemType,
  TeamPaymentDocumentType,
  TeamLifecycleStepStatus,
  TeamLifecycleIntervalUnit,
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
  @IsObject()
  metadata?: Record<string, unknown>;

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
  @IsObject()
  metadata?: Record<string, unknown> | null;

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
  @IsEnum(TeamMemberStatus)
  status?: TeamMemberStatus;

  @IsOptional()
  @IsString()
  avatarUrl?: string;

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
  @IsString()
  @MaxLength(120)
  workMode?: string;

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

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
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
  @IsString()
  @MaxLength(120)
  workMode?: string;

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

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown> | null;
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

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
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
  occurredAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  timezone?: string;

  @IsOptional()
  @IsString()
  note?: string;
}

export class GenerateTeamAttendanceReportPdfDto {
  @IsString()
  @MaxLength(500000)
  html!: string;
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

export class CreateTeamConfigOptionDto {
  @IsEnum(TeamConfigOptionType)
  type!: TeamConfigOptionType;

  @IsString()
  @MaxLength(160)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(24)
  color?: string | null;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown> | null;
}

export class UpdateTeamConfigOptionDto {
  @IsOptional()
  @IsEnum(TeamConfigOptionType)
  type?: TeamConfigOptionType;

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
  @IsObject()
  metadata?: Record<string, unknown> | null;

  @IsOptional()
  @IsEnum(TeamRecordStatus)
  status?: TeamRecordStatus;
}


export class ListTeamPaymentsQueryDto {
  @IsOptional()
  @IsUUID()
  batchId?: string;

  @IsOptional()
  @IsUUID()
  memberId?: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsEnum(TeamPaymentStatus)
  status?: TeamPaymentStatus;

  @IsOptional()
  @IsDateString()
  competenceStart?: string;

  @IsOptional()
  @IsDateString()
  competenceEnd?: string;

  @IsOptional()
  @IsString()
  activeOnly?: string;
}

export class GenerateTeamPaymentsDto {
  @IsDateString()
  competenceStart!: string;

  @IsDateString()
  competenceEnd!: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  memberIds?: string[];

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsEnum(TeamPaymentCalculationMode)
  calculationMode?: TeamPaymentCalculationMode;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class CreateTeamPaymentDto {
  @IsOptional()
  @IsUUID()
  batchId?: string | null;

  @IsUUID()
  memberId!: string;

  @IsOptional()
  @IsUUID()
  contractId?: string | null;

  @IsDateString()
  competenceStart!: string;

  @IsDateString()
  competenceEnd!: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string | null;

  @IsOptional()
  @IsEnum(TeamPaymentStatus)
  status?: TeamPaymentStatus;

  @IsOptional()
  @IsEnum(TeamPaymentCalculationMode)
  calculationMode?: TeamPaymentCalculationMode;

  @IsOptional()
  @IsString()
  baseAmount?: string;

  @IsOptional()
  @IsString()
  workedHours?: string;

  @IsOptional()
  @IsString()
  overtimeHours?: string;

  @IsOptional()
  @IsString()
  workedDays?: string;

  @IsOptional()
  @IsString()
  grossAmount?: string;

  @IsOptional()
  @IsString()
  benefitsTotal?: string;

  @IsOptional()
  @IsString()
  discountsTotal?: string;

  @IsOptional()
  @IsString()
  netAmount?: string;

  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @IsOptional()
  @IsString()
  notes?: string | null;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class UpdateTeamPaymentDto {
  @IsOptional()
  @IsUUID()
  contractId?: string | null;

  @IsOptional()
  @IsDateString()
  dueDate?: string | null;

  @IsOptional()
  @IsEnum(TeamPaymentStatus)
  status?: TeamPaymentStatus;

  @IsOptional()
  @IsEnum(TeamPaymentCalculationMode)
  calculationMode?: TeamPaymentCalculationMode;

  @IsOptional()
  @IsString()
  baseAmount?: string;

  @IsOptional()
  @IsString()
  workedHours?: string;

  @IsOptional()
  @IsString()
  overtimeHours?: string;

  @IsOptional()
  @IsString()
  workedDays?: string;

  @IsOptional()
  @IsString()
  grossAmount?: string;

  @IsOptional()
  @IsString()
  benefitsTotal?: string;

  @IsOptional()
  @IsString()
  discountsTotal?: string;

  @IsOptional()
  @IsString()
  netAmount?: string;

  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @IsOptional()
  @IsString()
  notes?: string | null;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class CreateTeamPaymentItemDto {
  @IsEnum(TeamPaymentItemType)
  type!: TeamPaymentItemType;

  @IsString()
  @MaxLength(180)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsString()
  amount?: string;

  @IsOptional()
  @IsString()
  quantity?: string;

  @IsOptional()
  @IsString()
  unitValue?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class UpdateTeamPaymentItemDto {
  @IsOptional()
  @IsEnum(TeamPaymentItemType)
  type?: TeamPaymentItemType;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsString()
  amount?: string;

  @IsOptional()
  @IsString()
  quantity?: string;

  @IsOptional()
  @IsString()
  unitValue?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class CreateTeamPaymentDocumentDto {
  @IsEnum(TeamPaymentDocumentType)
  type!: TeamPaymentDocumentType;

  @IsString()
  @MaxLength(180)
  title!: string;

  @IsOptional()
  @IsString()
  htmlContent?: string | null;

  @IsOptional()
  @IsString()
  pdfFileKey?: string | null;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class StartTeamMemberLifecycleDto {
  @IsOptional()
  @IsUUID()
  departmentId?: string;
}

export class CreateTeamMemberLifecycleStepDto {
  @IsString()
  @MaxLength(180)
  title!: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsUUID()
  stepTypeId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  assigneeLabel?: string | null;

  @IsOptional()
  @IsString()
  assignment?: string | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  intervalValue?: number | null;

  @IsOptional()
  @IsEnum(TeamLifecycleIntervalUnit)
  intervalUnit?: TeamLifecycleIntervalUnit | null;

  @IsOptional()
  @IsString()
  notes?: string | null;
}

export class UpdateTeamMemberLifecycleStepDto {
  @IsOptional()
  @IsString()
  @MaxLength(180)
  title?: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsUUID()
  stepTypeId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  assigneeLabel?: string | null;

  @IsOptional()
  @IsUUID()
  assigneeMemberId?: string | null;

  @IsOptional()
  @IsString()
  assignment?: string | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  intervalValue?: number | null;

  @IsOptional()
  @IsEnum(TeamLifecycleIntervalUnit)
  intervalUnit?: TeamLifecycleIntervalUnit | null;

  @IsOptional()
  @IsEnum(TeamLifecycleStepStatus)
  status?: TeamLifecycleStepStatus;

  @IsOptional()
  @IsString()
  notes?: string | null;

  @IsOptional()
  @IsNumber()
  sortOrder?: number;
}

export class MarkTeamPaymentPaidDto {
  @IsOptional()
  @IsDateString()
  paymentDate?: string;

  @IsOptional()
  @IsString()
  amount?: string;

  @IsOptional()
  @IsUUID()
  bankAccountId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;
}
