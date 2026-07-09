import { IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import type {
  LeadFlowAgentAvatarConfig,
  LeadFlowAgentBehaviorConfig,
  LeadFlowAgentChannelPolicy,
  LeadFlowAgentCrmPolicy,
  LeadFlowAgentHandoffPolicy,
  LeadFlowAgentPromptConfig,
  LeadFlowJsonObject,
} from '../types/leadflow-agent.types';

export class PatchAgentDto {
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
  promptConfig?: LeadFlowAgentPromptConfig;

  @IsOptional()
  @IsObject()
  handoffPolicy?: LeadFlowAgentHandoffPolicy;

  @IsOptional()
  @IsObject()
  crmPolicy?: LeadFlowAgentCrmPolicy;

  @IsOptional()
  @IsObject()
  channelPolicy?: LeadFlowAgentChannelPolicy;

  @IsOptional()
  @IsObject()
  avatarConfig?: LeadFlowAgentAvatarConfig;

  @IsOptional()
  @IsObject()
  metadata?: LeadFlowJsonObject;

  /**
   * Raw prompt overrides. Only applied when the caller holds the developer
   * permission; rejected otherwise (governance, not just ignored).
   */
  @IsOptional()
  @IsObject()
  developerOverrides?: LeadFlowJsonObject;
}
