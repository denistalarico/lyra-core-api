import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export enum LeadFlowAutomationCrmAction {
  MoveStage = 'move_opportunity_stage',
  TransferPipeline = 'transfer_opportunity_pipeline',
  CopyOpportunity = 'copy_opportunity',
}

/**
 * One governed CRM effect requested by an automation runtime.
 *
 * Targets and reason codes are repeated as execution-time evidence. The
 * executor accepts them only when they match the pinned published version.
 */
export class ExecuteCrmAutomationActionDto {
  @IsEnum(LeadFlowAutomationCrmAction)
  action!: LeadFlowAutomationCrmAction;

  @IsUUID()
  opportunityId!: string;

  @IsUUID()
  automationVersionId!: string;

  @ValidateIf(
    (value: ExecuteCrmAutomationActionDto) =>
      value.action === LeadFlowAutomationCrmAction.TransferPipeline ||
      value.action === LeadFlowAutomationCrmAction.CopyOpportunity,
  )
  @IsUUID()
  pipelineId?: string;

  @IsUUID()
  stageId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @IsString()
  @MaxLength(120)
  reasonCode!: string;

  @IsOptional()
  @IsUUID()
  expectedTransitionPolicyId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedTransitionPolicyVersion?: number;

  @IsOptional()
  @IsUUID()
  sourceEventId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  sourceEventName?: string;

  @IsOptional()
  @IsUUID()
  correlationId?: string;

  @IsOptional()
  @IsUUID()
  causationId?: string;
}
