import { IsEmail, IsIn, IsString, Length, MaxLength } from 'class-validator';

export class InviteWorkspaceUserDto {
  @IsString()
  @Length(2, 120)
  name!: string;

  @IsEmail()
  @MaxLength(160)
  email!: string;

  @IsIn(['owner', 'admin', 'manager', 'member'])
  role!: 'owner' | 'admin' | 'manager' | 'member';
}
