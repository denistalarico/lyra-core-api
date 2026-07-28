import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import type { AdminTwoFactorMethod } from '../types/admin-access.types';

export class AdminLoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;
}

export class AdminTwoFactorVerifyDto {
  @IsString()
  @IsNotEmpty()
  tempToken!: string;

  @IsString()
  @Matches(/^\d{6}$/)
  code!: string;
}

export class AdminTwoFactorEmailSendDto {
  @IsString()
  @IsNotEmpty()
  tempToken!: string;
}

export class AdminTwoFactorSetupDto {
  @IsString()
  @IsNotEmpty()
  tempToken!: string;

  @IsIn(['authenticator', 'email'])
  method!: AdminTwoFactorMethod;
}

export class AdminTwoFactorSetupConfirmDto extends AdminTwoFactorVerifyDto {
  @IsIn(['authenticator', 'email'])
  method!: AdminTwoFactorMethod;
}

export class AdminEmptyBodyDto {}

export class AdminPublicEmailDto {
  @IsEmail()
  @MaxLength(320)
  email!: string;
}

export class AdminIdentityTokenQueryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  token!: string;
}

export class CompleteAdminActivationDto extends AdminIdentityTokenQueryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  displayName!: string;

  @IsString()
  @MinLength(12)
  @MaxLength(128)
  password!: string;

  @IsString()
  @MaxLength(128)
  passwordConfirmation!: string;
}

export class ResetAdminPasswordDto extends AdminIdentityTokenQueryDto {
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  password!: string;

  @IsString()
  @MaxLength(128)
  passwordConfirmation!: string;
}
