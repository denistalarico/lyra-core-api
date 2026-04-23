// src/modules/settings/dto/patch-user-preferences.dto.ts
import { IsBoolean, IsIn, IsString } from 'class-validator';

export class PatchUserPreferencesDto {
  @IsIn(['light', 'dark', 'system'])
  themePreference!: 'light' | 'dark' | 'system';

  @IsIn(['pt-BR', 'en', 'es'])
  locale!: 'pt-BR' | 'en' | 'es';

  @IsString()
  timezone!: string;

  @IsString()
  dateFormat!: string;

  @IsIn(['12h', '24h'])
  timeFormat!: '12h' | '24h';

  @IsBoolean()
  sidebarCollapsed!: boolean;
}
