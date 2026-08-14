import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class PatchCrmOpportunityStageDto {
  @IsUUID()
  stageId!: string;

  @IsOptional()
  @IsInt()
  expectedVersion?: number;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsUUID()
  beforeOpportunityId?: string | null;

  /**
   * A human drag performed in the LeadFlow CRM. It deliberately bypasses the
   * published automation transition graph and takes the card into manual mode.
   */
  @IsOptional()
  @IsBoolean()
  manualOverride?: boolean;

  @IsString()
  @MaxLength(80)
  reasonCode!: string;
}
