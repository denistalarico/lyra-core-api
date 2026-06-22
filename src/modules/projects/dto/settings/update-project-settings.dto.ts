import { IsArray, IsIn, IsObject, IsOptional } from 'class-validator';

export class UpdateProjectSettingsDto {
  @IsOptional()
  @IsArray()
  projectMarkers?: Array<{ id: string; name: string; color: string }>;

  @IsOptional()
  @IsArray()
  taskMarkers?: Array<{ id: string; name: string; color: string }>;

  @IsOptional()
  @IsArray()
  taskTypes?: Array<{ id: string; name: string }>;

  @IsOptional()
  @IsIn(['manual', 'timer', 'hybrid'])
  taskExecutionMode?: 'manual' | 'timer' | 'hybrid';
}

export class UpdateProjectPreferencesDto {
  @IsOptional()
  @IsArray()
  overviewColumnOrder?: string[];

  @IsOptional()
  @IsObject()
  projectBoard?: {
    foldedStageIds?: string[];
    pinnedCardsByStage?: Record<string, string[]>;
    cardOrderByStage?: Record<string, string[]>;
  };

  @IsOptional()
  @IsObject()
  workspaceTaskBoard?: {
    foldedStageIds?: string[];
    pinnedCardsByStage?: Record<string, string[]>;
    cardOrderByStage?: Record<string, string[]>;
  };

  @IsOptional()
  @IsObject()
  personalTaskBoard?: {
    foldedStageIds?: string[];
    pinnedCardsByStage?: Record<string, string[]>;
    cardOrderByStage?: Record<string, string[]>;
  };
}
