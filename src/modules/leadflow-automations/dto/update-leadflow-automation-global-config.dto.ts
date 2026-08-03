import { IsInt, IsObject, IsOptional, Min } from 'class-validator';
import type { LeadFlowAutomationGlobalDefaults } from '../types/leadflow-automation.types';

export class UpdateLeadFlowAutomationGlobalConfigDto {
  /** Prevents overwriting a newer defaults version unknowingly. */
  @IsOptional()
  @IsInt()
  @Min(0)
  expectedVersion?: number;

  @IsObject()
  config!: LeadFlowAutomationGlobalDefaults;
}
