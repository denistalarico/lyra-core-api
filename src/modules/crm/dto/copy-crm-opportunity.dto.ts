import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CopyCrmOpportunityDto {
  @IsUUID()
  pipelineId!: string;

  @IsUUID()
  stageId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  title?: string;

  @IsOptional()
  @IsInt()
  expectedVersion?: number;

  @IsIn([
    'distinct_negotiation',
    'parallel_sales_process',
    'commercial_expansion',
  ])
  reasonCode!:
    | 'distinct_negotiation'
    | 'parallel_sales_process'
    | 'commercial_expansion';
}
