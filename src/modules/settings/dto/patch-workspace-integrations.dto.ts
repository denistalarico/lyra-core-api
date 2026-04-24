// src/modules/settings/dto/patch-workspace-integrations.dto.ts
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class WorkspaceIntegrationItemDto {
  @IsString()
  @MaxLength(80)
  itemId!: string;

  @IsIn(['integration', 'app'])
  category!: 'integration' | 'app';

  @IsIn(['available', 'connected', 'coming_soon', 'requires_setup'])
  status!: 'available' | 'connected' | 'coming_soon' | 'requires_setup';

  @IsBoolean()
  isInstalled!: boolean;

  @IsBoolean()
  isPinned!: boolean;

  @IsOptional()
  @IsInt()
  sidebarOrder?: number | null;
}

export class PatchWorkspaceIntegrationsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WorkspaceIntegrationItemDto)
  items!: WorkspaceIntegrationItemDto[];
}
