import { IsIn, IsNumberString, IsObject, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateCrmOpportunityEventDto {
  @IsOptional()
  @IsUUID()
  opportunityId?: string;

  @IsOptional()
  @IsIn(['user', 'ai', 'automation', 'system'])
  actorType?: string;

  @IsOptional()
  @IsUUID()
  actorUserId?: string | null;

  @IsString()
  @MaxLength(80)
  eventType!: string;

  @IsString()
  @MaxLength(180)
  title!: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsObject()
  beforeData?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  afterData?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  reason?: string | null;

  @IsOptional()
  @IsNumberString()
  confidence?: string | null;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
