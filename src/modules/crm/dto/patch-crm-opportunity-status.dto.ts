import { IsIn, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';

export class PatchCrmOpportunityStatusDto {
  @IsIn(['open', 'won', 'lost', 'archived'])
  status!: string;

  @IsOptional()
  @IsString()
  lostReason?: string | null;

  @IsOptional()
  @IsInt()
  expectedVersion?: number;

  @IsString()
  @MaxLength(80)
  reasonCode!: string;
}
