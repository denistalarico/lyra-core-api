import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class EmailServerConfigDto {
  @IsString()
  @MaxLength(255)
  host!: string;

  @IsString()
  @MaxLength(10)
  port!: string;

  @IsString()
  @MaxLength(160)
  username!: string;

  @IsString()
  password!: string;

  @IsIn(['none', 'ssl_tls', 'starttls'])
  security!: 'none' | 'ssl_tls' | 'starttls';
}

class IncomingEmailServerConfigDto extends EmailServerConfigDto {
  @IsIn(['imap', 'pop', 'local'])
  serverType!: 'imap' | 'pop' | 'local';
}

export class PatchWorkspaceEmailSettingsDto {
  @IsOptional()
  @IsEmail()
  @MaxLength(160)
  notificationEmail!: string;

  @ValidateNested()
  @Type(() => IncomingEmailServerConfigDto)
  incoming!: IncomingEmailServerConfigDto;

  @ValidateNested()
  @Type(() => EmailServerConfigDto)
  outgoing!: EmailServerConfigDto;
}
