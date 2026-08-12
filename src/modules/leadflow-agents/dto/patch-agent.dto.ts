import {
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

  /**
   * O papel do agente. Um agente provisionado como recepção pode virar
   * qualificação sem ser recriado — a troca reajusta as ações permitidas ao
   * novo papel e desvincula o preset de origem, já que ele deixou de ser
   * aquele modelo.
   */
  @IsOptional()
  @IsEnum(LeadFlowAgentType)
  type?: LeadFlowAgentType;

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
