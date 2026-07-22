import { IsInt, IsOptional, IsUUID } from 'class-validator';

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
}
