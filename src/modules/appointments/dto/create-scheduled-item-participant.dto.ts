import {
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateScheduledItemParticipantDto {
  @IsIn(['user', 'contact', 'external'])
  participantType!: string;

  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsUUID()
  contactId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  externalName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  externalEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  externalPhone?: string;

  @IsOptional()
  @IsIn(['needs_action', 'accepted', 'declined', 'tentative'])
  responseStatus?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
