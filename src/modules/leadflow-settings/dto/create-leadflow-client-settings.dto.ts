import {
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { LeadFlowSettingsStatus } from '../enums/leadflow-settings-status.enum';
import type {
  LeadFlowEnabledAppsConfig,
  LeadFlowEnabledIntegrationsConfig,
  LeadFlowJsonObject,
} from '../types/leadflow-settings.types';

export class CreateLeadFlowClientSettingsDto {
  @IsString()
  @MaxLength(80)
  businessModeKey!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  planKey?: string | null;

  @IsOptional()
  @IsEnum(LeadFlowSettingsStatus)
  status?: LeadFlowSettingsStatus;

  @IsOptional()
  @IsObject()
  enabledApps?: LeadFlowEnabledAppsConfig;

  @IsOptional()
  @IsObject()
  enabledIntegrations?: LeadFlowEnabledIntegrationsConfig;

  @IsOptional()
  @IsObject()
  permissionsConfig?: LeadFlowJsonObject;

  @IsOptional()
  @IsObject()
  brandingConfig?: LeadFlowJsonObject;

  @IsOptional()
  @IsObject()
  agentConfig?: LeadFlowJsonObject;

  @IsOptional()
  @IsObject()
  clientPromptConfig?: LeadFlowJsonObject;

  @IsOptional()
  @IsObject()
  inboxConfig?: LeadFlowJsonObject;

  @IsOptional()
  @IsObject()
  inboxOverrides?: LeadFlowJsonObject;

  @IsOptional()
  @IsObject()
  handoffOverrides?: LeadFlowJsonObject;

  @IsOptional()
  @IsObject()
  leadsConfig?: LeadFlowJsonObject;

  @IsOptional()
  @IsObject()
  pipelineRef?: LeadFlowJsonObject;

  @IsOptional()
  @IsObject()
  businessModeOverrides?: LeadFlowJsonObject;

  @IsOptional()
  @IsObject()
  metadata?: LeadFlowJsonObject;
}
