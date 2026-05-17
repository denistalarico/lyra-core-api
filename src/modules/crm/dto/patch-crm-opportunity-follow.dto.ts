import { IsBoolean, IsDateString, IsIn, IsOptional, IsString } from 'class-validator';

export class PatchCrmOpportunityFollowDto {
  @IsOptional()
  @IsIn(['automatic', 'manual', 'disabled'])
  followMode?: string;

  @IsOptional()
  @IsDateString()
  nextFollowUpAt?: string | null;

  @IsOptional()
  @IsString()
  followMessage?: string | null;

  @IsOptional()
  @IsBoolean()
  followSendAutomatically?: boolean;
}
