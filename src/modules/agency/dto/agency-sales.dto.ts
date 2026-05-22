import {
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import type {
  AgencySalesItemBillingType,
  AgencySalesItemStatus,
  AgencySalesItemType,
  AgencySalesActivityStatus,
  AgencySalesActivityType,
  AgencySalesOpportunityStatus,
  AgencySalesPipelineStatus,
  AgencySalesStageType,
} from '../entities/agency-sales.entities';

export class CreateAgencySalesItemDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsIn(['service', 'plan', 'setup', 'addon', 'product', 'custom'])
  type?: AgencySalesItemType;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  category?: string;

  @IsOptional()
  @IsIn(['one_time', 'recurring', 'setup_plus_recurring'])
  billingType?: AgencySalesItemBillingType;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  unitPriceCents?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  setupPriceCents?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  recurringPriceCents?: number;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  recurrenceInterval?: string;

  @IsOptional()
  @IsIn(['active', 'inactive', 'archived'])
  status?: AgencySalesItemStatus;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class UpdateAgencySalesItemDto extends CreateAgencySalesItemDto {}

export class UpdateAgencySalesProductSettingsDto {
  @IsArray()
  categories!: Array<Record<string, unknown>>;

  @IsArray()
  markers!: Array<Record<string, unknown>>;

  @IsOptional()
  @IsArray()
  units?: Array<Record<string, unknown>>;

  @IsOptional()
  @IsArray()
  opportunitySources?: string[];

  @IsOptional()
  @IsArray()
  lossReasons?: Array<Record<string, unknown>>;
}

export class CreateAgencySalesPipelineDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsIn(['active', 'inactive', 'archived'])
  status?: AgencySalesPipelineStatus;

  @IsOptional()
  isDefault?: boolean;

  @IsOptional()
  @IsInt()
  position?: number;
}

export class CreateAgencySalesStageDto {
  @IsUUID()
  pipelineId!: string;

  @IsString()
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @IsIn(['new', 'qualified', 'proposal', 'negotiation', 'won', 'lost', 'archived'])
  type?: AgencySalesStageType;

  @IsOptional()
  @IsInt()
  position?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  probability?: number;

  @IsOptional()
  isClosed?: boolean;

  @IsOptional()
  isWon?: boolean;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class UpdateAgencySalesStageDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsIn(['new', 'qualified', 'proposal', 'negotiation', 'won', 'lost', 'archived'])
  type?: AgencySalesStageType;

  @IsOptional()
  @IsInt()
  position?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  probability?: number;

  @IsOptional()
  isClosed?: boolean;

  @IsOptional()
  isWon?: boolean;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class ReorderAgencySalesStagesDto {
  @IsArray()
  @IsUUID('4', { each: true })
  stageIds!: string[];
}

export class CreateAgencySalesOpportunityDto {
  @IsString()
  @MaxLength(160)
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsUUID()
  pipelineId!: string;

  @IsUUID()
  stageId!: string;

  @IsOptional()
  @IsUUID()
  contactId?: string;

  @IsOptional()
  @IsUUID()
  companyContactId?: string;

  @IsOptional()
  @IsUUID()
  ownerUserId?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  amountCents?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  recurringAmountCents?: number;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string;

  @IsOptional()
  @IsIn(['open', 'won', 'lost', 'archived'])
  status?: AgencySalesOpportunityStatus;

  @IsOptional()
  @IsString()
  expectedCloseDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  lostReason?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class UpdateAgencySalesOpportunityDto extends CreateAgencySalesOpportunityDto {}

export class CreateAgencySalesQuickOpportunityDto {
  @IsString()
  @MaxLength(160)
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsUUID()
  pipelineId?: string;

  @IsOptional()
  @IsUUID()
  stageId?: string;

  @IsOptional()
  @IsUUID()
  contactId?: string;

  @IsOptional()
  @IsUUID()
  companyContactId?: string;

  @IsOptional()
  @IsUUID()
  ownerUserId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  amountCents?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  recurringAmountCents?: number;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string;

  @IsOptional()
  @IsString()
  expectedCloseDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  lostReason?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}


export class AgencySalesListQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  status?: string;
}


export class CreateAgencySalesOpportunityItemDto {
  @IsOptional()
  @IsUUID()
  salesItemId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(140)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsIn(['service', 'plan', 'setup', 'addon', 'product', 'custom'])
  type?: AgencySalesItemType;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  category?: string;

  @IsOptional()
  @IsIn(['one_time', 'recurring', 'setup_plus_recurring'])
  billingType?: AgencySalesItemBillingType;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  unitPriceCents?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  setupPriceCents?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  recurringPriceCents?: number;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  recurrenceInterval?: string;

  @IsOptional()
  @IsInt()
  position?: number;
}

export class UpdateAgencySalesOpportunityItemDto extends CreateAgencySalesOpportunityItemDto {}


export class MoveAgencySalesOpportunityDto {
  @IsUUID()
  stageId!: string;

  @IsOptional()
  @IsUUID()
  pipelineId?: string;
}


export class CreateAgencySalesActivityDto {
  @IsOptional()
  @IsUUID()
  contactId?: string;

  @IsOptional()
  @IsUUID()
  assignedUserId?: string;

  @IsOptional()
  @IsIn(['follow_up', 'meeting', 'call', 'task', 'email', 'whatsapp', 'note'])
  type?: AgencySalesActivityType;

  @IsString()
  @MaxLength(160)
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  dueAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  outcome?: string;

  @IsOptional()
  @IsInt()
  position?: number;
}

export class UpdateAgencySalesActivityDto extends CreateAgencySalesActivityDto {
  @IsOptional()
  @IsIn(['pending', 'done', 'canceled'])
  status?: AgencySalesActivityStatus;
}

export class CompleteAgencySalesActivityDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  outcome?: string;
}


export class WinAgencySalesOpportunityDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  outcome?: string;

  @IsOptional()
  @IsString()
  closedAt?: string;
}

export class LoseAgencySalesOpportunityDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  lostReason?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  outcome?: string;

  @IsOptional()
  @IsString()
  closedAt?: string;
}

export class ReopenAgencySalesOpportunityDto {
  @IsOptional()
  @IsUUID()
  stageId?: string;

  @IsOptional()
  @IsUUID()
  pipelineId?: string;
}
