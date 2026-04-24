import { IsEmail, MaxLength } from 'class-validator';

export class PatchSecurityEmailDto {
  @IsEmail()
  @MaxLength(160)
  newEmail!: string;
}
