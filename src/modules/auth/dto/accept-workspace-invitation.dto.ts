import { IsOptional, IsString, Length, MinLength } from 'class-validator';

export class AcceptWorkspaceInvitationDto {
  @IsString()
  @Length(2, 120)
  displayName!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsOptional()
  @IsString()
  confirmPassword?: string;
}
