// src/modules/settings/dto/patch-workspace-ai-settings.dto.ts
import { IsBoolean, IsIn } from 'class-validator';

export class PatchWorkspaceAiSettingsDto {
  @IsIn(['pt-BR', 'en', 'es'])
  defaultAgentLanguage!: 'pt-BR' | 'en' | 'es';

  @IsIn(['professional', 'friendly', 'consultative', 'direct'])
  defaultTone!: 'professional' | 'friendly' | 'consultative' | 'direct';

  @IsBoolean()
  enableSuggestions!: boolean;

  @IsBoolean()
  enableAutofill!: boolean;

  @IsBoolean()
  enableAutoSummaries!: boolean;

  @IsBoolean()
  enableContextualSuggestions!: boolean;
}
