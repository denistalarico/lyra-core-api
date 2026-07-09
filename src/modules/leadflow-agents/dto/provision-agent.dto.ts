import {
  IsBoolean,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { LeadFlowAgentType } from '../enums/leadflow-agent-type.enum';
import type {
  LeadFlowAgentAvatarConfig,
  LeadFlowAgentBehaviorConfig,
} from '../types/leadflow-agent.types';

export class ProvisionAgentDto {
  /** Provision from a predefined preset compatible with the active mode. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  presetKey?: string;

  /** Provision a custom agent (required when no preset is given). */
  @IsOptional()
  @IsEnum(LeadFlowAgentType)
  type?: LeadFlowAgentType;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsObject()
  behaviorConfig?: LeadFlowAgentBehaviorConfig;

  @IsOptional()
  @IsObject()
  avatarConfig?: LeadFlowAgentAvatarConfig;

  /** When true, activates the agent right after provisioning. */
  @IsOptional()
  @IsBoolean()
  activate?: boolean;
}
