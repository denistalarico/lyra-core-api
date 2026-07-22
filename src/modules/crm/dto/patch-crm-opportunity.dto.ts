import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumberString,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class PatchCrmOpportunityDto {
  @IsOptional()
  @IsInt()
  expectedVersion?: number;

  @IsOptional()
  @IsUUID()
  pipelineId?: string;

  @IsOptional()
  @IsUUID()
  stageId?: string;

  @IsOptional()
  @IsUUID()
  contactId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  contactName?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  contactEmail?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  contactPhone?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  title?: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsNumberString()
  valueAmount?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(12)
  currency?: string;

  @IsOptional()
  @IsIn(['open', 'won', 'lost', 'archived'])
  status?: string;

  @IsOptional()
  @IsIn(['low', 'normal', 'high', 'urgent'])
  priority?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  source?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  businessMode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  operationalStatus?: string | null;

  @IsOptional()
  @IsObject()
  businessContext?: Record<string, unknown>;

  @IsOptional()
  @IsUUID()
  assignedUserId?: string | null;

  @IsOptional()
  @IsDateString()
  expectedCloseDate?: string | null;

  @IsOptional()
  @IsDateString()
  nextFollowUpAt?: string | null;

  @IsOptional()
  @IsString()
  lostReason?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  cardColor?: string | null;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsIn(['workspace', 'assigned_only', 'private'])
  visibility?: string;

  @IsOptional()
  @IsIn(['automatic', 'manual', 'disabled'])
  followMode?: string;

  @IsOptional()
  @IsString()
  followMessage?: string | null;

  @IsOptional()
  @IsBoolean()
  followSendAutomatically?: boolean;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
