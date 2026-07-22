import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class ReconvertCrmOpportunityDto {
  @IsUUID()
  pipelineId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  title?: string;

  @IsOptional()
  @IsInt()
  expectedVersion?: number;

  @IsIn(['new_conversion', 'renewed_interest', 'new_sales_cycle'])
  reasonCode!: 'new_conversion' | 'renewed_interest' | 'new_sales_cycle';
}
