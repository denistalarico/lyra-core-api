// src/modules/settings/dto/patch-user-profile.dto.ts
import {
  IsEmail,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';

export class PatchUserProfileDto {
  @IsString()
  @Length(2, 60)
  firstName!: string;

  @IsString()
  @Length(2, 60)
  lastName!: string;

  @IsString()
  @Length(2, 120)
  displayName!: string;

  @IsEmail()
  @MaxLength(160)
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  jobTitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(280)
  bio?: string;
}
