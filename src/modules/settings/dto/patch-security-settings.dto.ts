import { IsBoolean, IsOptional } from 'class-validator';

export class PatchSecuritySettingsDto {
  @IsBoolean()
  @IsOptional()
  loginAlertsEnabled?: boolean;

  @IsBoolean()
  @IsOptional()
  trustedDevicesEnabled?: boolean;
}
