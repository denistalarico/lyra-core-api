import {
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

  @IsString()
  @MaxLength(80)
  reasonCode!: string;
}
