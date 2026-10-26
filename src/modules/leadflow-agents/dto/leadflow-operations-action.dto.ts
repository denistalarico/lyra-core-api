import {
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
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

  /** OR5: the agent the request was made to; its scope limits the proposal. */
  @IsOptional()
  @IsUUID()
  agentId?: string;
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
  /** OR5: the agent the proposal was made to (`null` = the Orion). */
  agentId: string | null;
  targetType: string | null;
  /** The execution outcome of an OR5 intent, once confirmed. */
  result: Record<string, unknown> | null;
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
