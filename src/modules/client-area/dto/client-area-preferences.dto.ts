import { IsBoolean, IsIn, ValidateIf } from 'class-validator';
export class PatchClientAreaPreferencesDto {
  @ValidateIf((_o: unknown, v: unknown) => v !== undefined)
  @IsIn(['light', 'dark', 'system'])
  theme?: 'light' | 'dark' | 'system';
  @ValidateIf((_o: unknown, v: unknown) => v !== undefined)
  @IsIn(['pt-BR', 'en', 'es'])
  locale?: 'pt-BR' | 'en' | 'es';
  @ValidateIf((_o: unknown, v: unknown) => v !== undefined)
  @IsBoolean()
  sidebarCollapsed?: boolean;
}
