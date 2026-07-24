import { IsIn, IsInt, IsOptional } from 'class-validator';

export class PatchCrmOpportunityAutonomyModeDto {
  @IsIn(['automatic', 'manual'])
  mode!: 'automatic' | 'manual';

  @IsOptional()
  @IsInt()
  expectedVersion?: number;
}
