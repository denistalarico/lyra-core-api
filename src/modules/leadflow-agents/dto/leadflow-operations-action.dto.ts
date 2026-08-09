import {
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  LEADFLOW_OPERATIONS_ACTION_INTENTS,
  type LeadFlowOperationsActionIntent,
  type LeadFlowOperationsActionStatus,
} from '../entities';

export class CreateLeadFlowOperationsActionDto {
  @IsIn(LEADFLOW_OPERATIONS_ACTION_INTENTS)
  intent!: LeadFlowOperationsActionIntent;

  @IsString()
  @MinLength(1)
  @MaxLength(4_000)
  requestText!: string;

  @IsObject()
  payload!: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  idempotencyKey?: string;
}

export class ConfirmLeadFlowOperationsActionDto {
  @IsInt()
  @Min(1)
  expectedRevision!: number;
}

export type LeadFlowOperationsActionResponse = {
  id: string;
  businessModeKey: string;
  intent: LeadFlowOperationsActionIntent;
  status: LeadFlowOperationsActionStatus;
  requestText: string;
  payload: Record<string, unknown>;
  preview: Record<string, unknown>;
  validationIssues: string[];
  canConfirm: boolean;
  revision: number;
  effectiveFrom: string | null;
  effectiveUntil: string | null;
  timezone: string | null;
  createdAt: string;
  confirmedAt: string | null;
  cancelledAt: string | null;
};

export type LeadFlowOperationsActionListResponse = {
  items: LeadFlowOperationsActionResponse[];
};
