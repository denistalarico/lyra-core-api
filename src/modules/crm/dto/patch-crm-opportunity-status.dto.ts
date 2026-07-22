import { IsIn, IsInt, IsOptional, IsString } from 'class-validator';

export class PatchCrmOpportunityStatusDto {
  @IsIn(['open', 'won', 'lost', 'archived'])
  status!: string;

  @IsOptional()
  @IsString()
  lostReason?: string | null;

  @IsOptional()
  @IsInt()
  expectedVersion?: number;
}
