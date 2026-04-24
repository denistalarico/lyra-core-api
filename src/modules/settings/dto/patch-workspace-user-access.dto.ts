import { IsBoolean, IsIn, IsObject, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class WorkspaceUserModuleAccessDto {
  @IsBoolean()
  enabled!: boolean;

  @IsIn(['admin', 'manager', 'member'])
  permission!: 'admin' | 'manager' | 'member';
}

export class PatchWorkspaceUserAccessDto {
  @IsIn(['owner', 'admin', 'manager', 'member'])
  role!: 'owner' | 'admin' | 'manager' | 'member';

  @IsObject()
  @ValidateNested({ each: true })
  @Type(() => WorkspaceUserModuleAccessDto)
  modules!: Record<
    | 'inbox'
    | 'crm'
    | 'agents'
    | 'automations'
    | 'analytics'
    | 'social'
    | 'settings',
    WorkspaceUserModuleAccessDto
  >;
}
