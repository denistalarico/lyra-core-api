import { IsEmail, IsIn, IsNotEmpty, IsString, Matches } from 'class-validator';
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
