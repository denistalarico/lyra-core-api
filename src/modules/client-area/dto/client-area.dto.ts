import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { CLIENT_AREA_ROLES } from '../client-area.types';

/**
 * CA2 — request bodies of the Client Area invitation/reset endpoints and of
 * the Agency member management routes. With the global
 * `forbidNonWhitelisted` pipe, anything not declared here (a `role`,
 * `companyContextId` or `email` in an acceptance body) is refused — company,
 * role and email of an acceptance only ever come from the invitation row.
 */

const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

export class ClientAreaInvitationTokenDto {
  @IsString()
  @Matches(TOKEN_PATTERN)
  token!: string;
}

export class AcceptClientAreaInvitationDto extends ClientAreaInvitationTokenDto {
  @IsIn(['signup', 'login'])
  mode!: 'signup' | 'login';

  @IsOptional()
  @IsString()
  @MaxLength(256)
  password?: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  passwordConfirmation?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  displayName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  twoFactorToken?: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  code?: string;
}

export class ClientAreaInvitationTwoFactorEmailDto {
  @IsString()
  @MaxLength(2048)
  twoFactorToken!: string;
}

export class ClientAreaForgotPasswordDto {
  @IsEmail()
  @MaxLength(160)
  email!: string;
}

export class ClientAreaResetPasswordDto {
  @IsString()
  @Matches(TOKEN_PATTERN)
  token!: string;

  @IsString()
  @MaxLength(256)
  password!: string;

  @IsString()
  @MaxLength(256)
  passwordConfirmation!: string;
}

export class CreateClientAreaInvitationDto {
  @IsEmail()
  @MaxLength(160)
  email!: string;

  @IsIn(CLIENT_AREA_ROLES)
  role!: string;
}

export class ChangeClientAreaMemberRoleDto {
  @IsIn(CLIENT_AREA_ROLES)
  role!: string;
}
