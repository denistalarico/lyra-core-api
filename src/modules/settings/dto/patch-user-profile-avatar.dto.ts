// src/modules/settings/dto/patch-user-profile-avatar.dto.ts
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class PatchUserProfileAvatarDto {
  @IsOptional()
  @IsString()
  avatarUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  avatarAssetKey?: string;
}
