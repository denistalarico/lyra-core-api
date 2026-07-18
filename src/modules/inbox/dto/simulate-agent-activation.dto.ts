import {
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class SimulateAgentActivationDto {
  @IsUUID() channelId!: string;
  @IsOptional() @IsString() @MaxLength(4000) messageText?: string;
  @IsOptional()
  @IsIn(['paused', 'ai_active', 'human_active', 'closed', 'new'])
  conversationState?: string;
  @IsOptional() @IsBoolean() internalContact?: boolean;
  @IsOptional() @IsBoolean() duplicate?: boolean;
  @IsOptional()
  @IsIn(['pending', 'qualified', 'disqualified', 'non_lead', 'internal'])
  qualificationStatus?: string;
  @IsOptional() @IsBoolean() referralTrusted?: boolean;
  @IsOptional() @IsObject() referral?: Record<string, unknown>;
}
