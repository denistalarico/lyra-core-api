import { IsArray, IsObject, IsOptional } from 'class-validator';

export class PatchInboxSettingsDto {
  @IsOptional()
  @IsArray()
  tags?: Array<Record<string, unknown>>;

  @IsOptional()
  @IsArray()
  channels?: Array<Record<string, unknown>>;

  @IsOptional()
  @IsArray()
  aiAssignmentRules?: Array<Record<string, unknown>>;

  @IsOptional()
  @IsArray()
  humanAssignmentRules?: Array<Record<string, unknown>>;

  @IsOptional()
  @IsObject()
  notificationSettings?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  businessHours?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  conversationAutomations?: Array<Record<string, unknown>>;

  @IsOptional()
  @IsArray()
  quickReplies?: Array<Record<string, unknown>>;

  @IsOptional()
  @IsArray()
  leadRules?: Array<Record<string, unknown>>;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
