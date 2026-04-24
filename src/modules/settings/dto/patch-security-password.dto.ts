import { IsString, Length } from 'class-validator';

export class PatchSecurityPasswordDto {
  @IsString()
  currentPassword!: string;

  @IsString()
  @Length(8, 120)
  newPassword!: string;
}
