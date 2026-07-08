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

export class ValidateLeadFlowClientSettingsDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  businessModeKey?: string;

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
  clientPromptConfig?: LeadFlowJsonObject;

  @IsOptional()
  @IsObject()
  metadata?: LeadFlowJsonObject;
}
