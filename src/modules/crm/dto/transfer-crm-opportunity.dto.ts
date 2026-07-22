import { IsIn, IsInt, IsOptional, IsUUID } from 'class-validator';

export class TransferCrmOpportunityDto {
  @IsUUID()
  pipelineId!: string;

  @IsUUID()
  stageId!: string;

  @IsOptional()
  @IsInt()
  expectedVersion?: number;

  @IsIn(['manual_pipeline_transfer', 'sales_process_reroute'])
  reasonCode!: 'manual_pipeline_transfer' | 'sales_process_reroute';
}
