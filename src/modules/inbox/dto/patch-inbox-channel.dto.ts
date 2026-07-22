import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

/** Operational allowlist only. Provider identity, credentials and ownership are lifecycle-owned. */
export class PatchInboxChannelDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(140)
  name?: string;

  @IsOptional()
  @IsBoolean()
  aiEnabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(300)
  debounceSeconds?: number;

  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsUUID()
  defaultPipelineId?: string | null;
}

export class InboxChannelLifecycleDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
