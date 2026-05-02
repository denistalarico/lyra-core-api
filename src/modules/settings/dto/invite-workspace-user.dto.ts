import { IsEmail, IsIn, MaxLength } from 'class-validator';

export class InviteWorkspaceUserDto {
  @IsEmail()
  @MaxLength(160)
  email!: string;

  @IsIn(['member', 'manager', 'administrator'])
  role!: 'member' | 'manager' | 'administrator';
}
