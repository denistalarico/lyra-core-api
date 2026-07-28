import { Transform, Type } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  PLATFORM_ADMIN_ROLE_KEYS,
  PLATFORM_ADMIN_STATUSES,
  type PlatformAdminRoleKey,
  type PlatformAdminStatus,
} from '../types/admin-access.types';
import {
  PLATFORM_ADMIN_INVITATION_STATUSES,
  type PlatformAdminInvitationStatus,
} from '../entities/platform-admin-invitation.entity';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class ListAdminInternalUsersQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  @Transform(trim)
  search?: string;

  @IsOptional()
  @IsIn(PLATFORM_ADMIN_STATUSES)
  status?: PlatformAdminStatus;

  @IsOptional()
  @IsIn(PLATFORM_ADMIN_ROLE_KEYS)
  roleKey?: PlatformAdminRoleKey;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;

  @IsOptional()
  @IsIn(['createdAt:desc', 'createdAt:asc', 'name:asc', 'name:desc'])
  sort: 'createdAt:desc' | 'createdAt:asc' | 'name:asc' | 'name:desc' =
    'createdAt:desc';
}

export class ChangeAdminInternalUserRoleDto {
  @IsIn(PLATFORM_ADMIN_ROLE_KEYS)
  roleKey!: PlatformAdminRoleKey;
}

export class CreateAdminInvitationDto {
  @IsEmail()
  @MaxLength(320)
  @Transform(trim)
  email!: string;

  @IsIn(PLATFORM_ADMIN_ROLE_KEYS)
  roleKey!: PlatformAdminRoleKey;
}

export class ListAdminInvitationsQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  @Transform(trim)
  search?: string;

  @IsOptional()
  @IsIn(PLATFORM_ADMIN_INVITATION_STATUSES)
  status?: PlatformAdminInvitationStatus;

  @IsOptional()
  @IsIn(PLATFORM_ADMIN_ROLE_KEYS)
  roleKey?: PlatformAdminRoleKey;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}

export class AcceptAdminInvitationDto {
  @IsString()
  @MinLength(32)
  @MaxLength(512)
  token!: string;
}

export class ValidateAdminInvitationQueryDto {
  @IsString()
  @MinLength(32)
  @MaxLength(512)
  token!: string;
}

export class AdminIdParamDto {
  @IsUUID()
  adminId!: string;
}

export class InvitationIdParamDto {
  @IsUUID()
  invitationId!: string;
}
