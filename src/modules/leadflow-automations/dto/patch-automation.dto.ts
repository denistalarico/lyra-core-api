import { IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import type {
  LeadFlowAutomationActionConfig,
  LeadFlowAutomationConditionConfig,
  LeadFlowAutomationCrmPolicy,
  LeadFlowAutomationDeveloperConfig,
  LeadFlowAutomationMessageConfig,
  LeadFlowAutomationSchedulePolicy,
  LeadFlowAutomationTriggerConfig,
  LeadFlowAutomationWebhookConfig,
} from '../types/leadflow-automation.types';

export class PatchAutomationDto {
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
  triggerConfig?: LeadFlowAutomationTriggerConfig;

  @IsOptional()
  @IsObject()
  conditionConfig?: LeadFlowAutomationConditionConfig;

  @IsOptional()
  @IsObject()
  actionConfig?: LeadFlowAutomationActionConfig;

  @IsOptional()
  @IsObject()
  messageConfig?: LeadFlowAutomationMessageConfig;

  @IsOptional()
  @IsObject()
  crmPolicy?: LeadFlowAutomationCrmPolicy;

  @IsOptional()
  @IsObject()
  schedulePolicy?: LeadFlowAutomationSchedulePolicy;

  /**
   * Developer-only flags. Applied only when the caller holds the developer
   * permission; rejected otherwise (governance, not silently ignored).
   */
  @IsOptional()
  @IsObject()
  developerConfig?: LeadFlowAutomationDeveloperConfig;

  /**
   * Developer webhook config. The raw `secret` is persisted but never returned.
   * Applied only when the caller holds the developer permission.
   */
  @IsOptional()
  @IsObject()
  webhookConfig?: LeadFlowAutomationWebhookConfig;
}
