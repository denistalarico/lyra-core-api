import {
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import type { AdminTwoFactorMethod } from '../types/admin-access.types';

export class UpdateAdminProfileDto {
  @IsString()
  @Length(2, 120)
  displayName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  jobTitle?: string | null;
}

export class UpdateAdminPreferencesDto {
  @IsIn(['pt-BR', 'en-US'])
  locale!: 'pt-BR' | 'en-US';

  @IsIn(['light', 'dark', 'system'])
  theme!: 'light' | 'dark' | 'system';

  @IsString()
  @Length(1, 80)
  timezone!: string;

  @IsIn(['dd/MM/yyyy', 'MM/dd/yyyy', 'yyyy-MM-dd'])
  dateFormat!: string;

  @IsIn(['12h', '24h'])
  timeFormat!: '12h' | '24h';
}

export class ChangeAdminPasswordDto {
  @IsString()
  @MinLength(1)
  currentPassword!: string;

  @IsString()
  @MinLength(12)
  @MaxLength(128)
  newPassword!: string;
}

export class BeginAdminTwoFactorSetupDto {
  @IsIn(['authenticator', 'email'])
  method!: AdminTwoFactorMethod;

  @IsString()
  @MinLength(1)
  currentPassword!: string;
}

export class ConfirmAdminTwoFactorSetupDto {
  @IsIn(['authenticator', 'email'])
  method!: AdminTwoFactorMethod;

  @IsString()
  @Matches(/^\d{6}$/)
  code!: string;
}

export class DisableAdminTwoFactorDto {
  @IsString()
  @MinLength(1)
  currentPassword!: string;
}
